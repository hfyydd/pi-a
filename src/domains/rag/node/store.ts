// src/domains/rag/node/store.ts
// RAG 向量召回（对照 08 计划功能18）。
// MVP 用 TF-IDF + 余弦相似度（本地，无 embedding 依赖）。
// 中文用 bigram，英文用单词。P2 升级：接入 embedding API 或本地 onnx 模型。

import { getDb } from "../../../infra/db.ts";
import { readDoc } from "../../doc/node/reader.ts";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

function uuid(): string { return crypto.randomUUID(); }

/** 分块：按段落优先，超长段落按字符切分（带重叠） */
function splitText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paras) {
    if ((buf + p).length > size && buf) {
      chunks.push(buf);
      buf = buf.slice(-overlap) + "\n\n" + p;
    } else {
      buf += (buf ? "\n\n" : "") + p;
    }
    while (buf.length > size * 1.5) {
      chunks.push(buf.slice(0, size));
      buf = buf.slice(size - overlap);
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter((c) => c.trim());
}

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "也", "都", "就", "还", "又", "这", "那", "我", "你", "他", "她", "它", "们", "个", "把", "被", "让", "使", "给", "对", "向", "从", "到", "于", "以", "为", "由",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "in", "on", "at", "to", "for", "and", "or", "but", "with", "from", "by", "as", "this", "that", "it", "he", "she", "we", "you", "they",
]);

/** 分词：英文单词 + 中文 bigram，去停用词 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const en = text.toLowerCase().match(/[a-z][a-z0-9]+/g) || [];
  for (const w of en) if (w.length > 2 && !STOP_WORDS.has(w)) tokens.push(w);
  const cn = text.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cn) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bg = seg.slice(i, i + 2);
      if (!STOP_WORDS.has(bg)) tokens.push(bg);
    }
  }
  return tokens;
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const bv = b.get(k); if (bv) dot += v * bv; }
  for (const [, v] of b) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Chunk {
  id: string;
  docPath: string;
  chunkIndex: number;
  text: string;
  createdAt: number;
}

/** 索引文档：分块 + 关键词频存 DB */
export async function indexDoc(path: string): Promise<number> {
  const { text } = await readDoc(path);
  if (!text.trim()) return 0;
  const db = getDb();
  db.prepare("DELETE FROM doc_chunks WHERE doc_path = ?").run(path);
  const chunks = splitText(text);
  const now = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    const tf = termFreq(tokenize(chunks[i]));
    db.prepare(
      "INSERT INTO doc_chunks (id, doc_path, chunk_index, text, keywords, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(uuid(), path, i, chunks[i], JSON.stringify([...tf.entries()]), now);
  }
  return chunks.length;
}

/** 列出已索引文档 */
export function listIndexedDocs(): { docPath: string; count: number; latestAt: number }[] {
  const db = getDb();
  return db.prepare(
    "SELECT doc_path as docPath, COUNT(*) as count, MAX(created_at) as latestAt FROM doc_chunks GROUP BY doc_path ORDER BY latestAt DESC",
  ).all() as unknown as { docPath: string; count: number; latestAt: number }[];
}

/** 删除索引 */
export function deleteIndex(docPath: string): void {
  const db = getDb();
  db.prepare("DELETE FROM doc_chunks WHERE doc_path = ?").run(docPath);
}

/** 检索相关块（TF-IDF 余弦相似度） */
export async function searchChunks(
  query: string,
  docPath?: string,
  topK = 5,
): Promise<{ text: string; score: number; docPath: string; chunkIndex: number }[]> {
  const db = getDb();
  const qTf = termFreq(tokenize(query));
  const rows = (docPath
    ? db.prepare("SELECT text, keywords, doc_path as docPath, chunk_index as chunkIndex FROM doc_chunks WHERE doc_path = ?").all(docPath)
    : db.prepare("SELECT text, keywords, doc_path as docPath, chunk_index as chunkIndex FROM doc_chunks").all()
  ) as unknown as { text: string; keywords: string; docPath: string; chunkIndex: number }[];

  // 计算 IDF（文档频率：每个 term 出现在多少 chunk 里）
  const N = rows.length;
  const dfMap = new Map<string, number>();
  for (const r of rows) {
    const terms = (JSON.parse(r.keywords || "[]") as [string, number][]);
    for (const [term] of terms) {
      dfMap.set(term, (dfMap.get(term) ?? 0) + 1);
    }
  }
  // IDF 权重函数
  const idf = (term: string): number => {
    const df = dfMap.get(term) ?? 0;
    return Math.log(N / (1 + df));
  };

  // 查询向量加 IDF 权重
  const qWeighted = new Map<string, number>();
  for (const [term, freq] of qTf) {
    qWeighted.set(term, freq * idf(term));
  }

  const scored = rows.map((r) => {
    const tf = new Map<string, number>(JSON.parse(r.keywords || "[]") as [string, number][]);
    // 文档向量加 IDF 权重
    const dWeighted = new Map<string, number>();
    for (const [term, freq] of tf) {
      dWeighted.set(term, freq * idf(term));
    }
    return { text: r.text, docPath: r.docPath, chunkIndex: r.chunkIndex, score: cosineSim(qWeighted, dWeighted) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter((s) => s.score > 0);
}
