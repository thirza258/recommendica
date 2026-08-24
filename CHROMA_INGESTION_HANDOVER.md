# ChromaDB Data Ingestion & Handover Specification

This document provides complete technical specifications for downstream applications integrating with the **arXiv ChromaDB Vector Store**. Follow this guide to ensure schema consistency, proper embedding model alignment, metadata filtering compatibility, and seamless querying/ingestion.

---

## 1. Architecture & Service Endpoints

```
 ┌──────────────────────┐         ┌─────────────────────────┐
 │   arXiv Metadata     │         │   Ollama Service        │
 │   JSONL Records      │         │   Model: embeddinggemma │
 └──────────┬───────────┘         └────────────┬────────────┘
            │                                  │
            │ Generate Text:                   │ Generate Vectors:
            │ "Title: ...\n\nAbstract: ..."    │ POST /api/embed
            ▼                                  ▼
     ┌──────────────────────────────────────────────┐
     │           ChromaDB Vector Store              │
     │  Collection: arxiv_embeddings (Port 5050)    │
     └──────────────────────────────────────────────┘
```

### Connection Details

| Property | Default Value | Description |
| :--- | :--- | :--- |
| **Chroma HTTP Host** | `http://localhost:5050` | Exposed Docker port (mapped to internal `8000`) |
| **Tenant** | `default_tenant` | Default Chroma tenant |
| **Database** | `default_database` | Default Chroma database |
| **Collection Name** | `arxiv_embeddings` | Target collection storing the vector embeddings |
| **Embedding Engine** | `http://localhost:11434` | Ollama HTTP Server |
| **Embedding Model** | `embeddinggemma` | Text embedding model used for vector generation |

---

## 2. Collection Metadata

The collection is initialized with the following configuration metadata:

```json
{
  "description": "arXiv embeddings generated from title + abstract",
  "embedding_model": "embeddinggemma",
  "source_file": "arxiv_data/arxiv-metadata-oai-snapshot.json",
  "ingested_with": "ingest_arxiv_to_chroma.py"
}
```

---

## 3. Data Schema & Record Structure

Each record in Chroma consists of 4 main attributes: `id`, `document`, `embedding`, and `metadata`.

### 3.1 Record ID (`ids`)
* **Format**: String. Matches arXiv identifier (e.g., `"0704.0001"`, `"2103.14030"`).
* **Fallback**: If `id` is null, formatted as `"line-<line_number>"`.

### 3.2 Document Content (`documents`)
The document text stored and used for vector generation is formed by concatenating the paper's title and abstract:

```python
# Document formatting rule:
if title and abstract:
    document = f"Title: {title.strip()}\n\nAbstract: {abstract.strip()}"
elif title:
    document = f"Title: {title.strip()}"
else:
    document = abstract.strip()
```

### 3.3 Embeddings (`embeddings`)
* **Model**: `embeddinggemma` via Ollama.
* **Truncation**: Enabled (`"truncate": true`).
* **Generation Payload**:
  ```json
  POST http://localhost:11434/api/embed
  {
    "model": "embeddinggemma",
    "input": ["Title: ...\n\nAbstract: ..."],
    "truncate": true
  }
  ```

### 3.4 Metadata Attributes (`metadatas`)

ChromaDB only accepts primitive metadata types (`str`, `int`, `float`, `bool`). Any nested objects/arrays are serialized as JSON strings, and `null` fields are omitted.

| Field Name | Type in Chroma | Description / Example | Serialization Rule |
| :--- | :--- | :--- | :--- |
| `id` | `string` | arXiv paper ID (e.g., `"0704.0001"`) | Primitive |
| `title` | `string` | Paper title | Primitive (cleaned/trimmed) |
| `abstract` | `string` | Paper abstract text | Primitive |
| `authors` | `string` | Formatted author string (e.g. `"Ileana Streinu and Louis Theran"`) | Primitive |
| `submitter` | `string` | Submitter name | Primitive (omitted if null) |
| `categories` | `string` | Space-separated category codes (e.g. `"math.CO cs.CG"`) | Primitive |
| `comments` | `string` | Page numbers, figure info, conference notes | Primitive (omitted if null) |
| `journal-ref` | `string` | Journal publication reference | Primitive (omitted if null) |
| `doi` | `string` | Digital Object Identifier (e.g., `"10.1103/PhysRevD.76.013009"`) | Primitive (omitted if null) |
| `report-no` | `string` | Report number | Primitive (omitted if null) |
| `license` | `string` | License URI | Primitive (omitted if null) |
| `update_date` | `string` | Last updated date (`"YYYY-MM-DD"`) | Primitive |
| `versions` | `string` (JSON) | Array of versions with creation timestamps | `json.dumps(versions)` |
| `authors_parsed`| `string` (JSON) | Array of parsed author tuples: `[["Last", "First", "Suffix"]]` | `json.dumps(authors_parsed)` |

#### Example Serialized Metadata Object:
```json
{
  "id": "0704.0002",
  "submitter": "Louis Theran",
  "authors": "Ileana Streinu and Louis Theran",
  "title": "Sparsity-certifying Graph Decompositions",
  "comments": "To appear in Graphs and Combinatorics",
  "categories": "math.CO cs.CG",
  "license": "http://arxiv.org/licenses/nonexclusive-distrib/1.0/",
  "abstract": "We describe a new algorithm, the $(k,\\ell)$-pebble game with colors...",
  "update_date": "2008-12-13",
  "versions": "[{\"version\":\"v1\",\"created\":\"Sat, 31 Mar 2007 02:26:18 GMT\"},{\"version\":\"v2\",\"created\":\"Sat, 13 Dec 2008 17:26:00 GMT\"}]",
  "authors_parsed": "[[\"Streinu\",\"Ileana\",\"\"],[\"Theran\",\"Louis\",\"\"]]"
}
```

---

## 4. How to Query the Chroma Vector Store

Downstream applications should generate query vectors using the **same embedding model (`embeddinggemma`)** to ensure vector space compatibility.

### 4.1 Python Example (Chroma Client + Ollama)

```python
import json
import chromadb
import requests

CHROMA_HOST = "localhost"
CHROMA_PORT = 5050
COLLECTION_NAME = "arxiv_embeddings"
OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "embeddinggemma"

# 1. Connect to Chroma
client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
collection = client.get_collection(name=COLLECTION_NAME)

def get_embedding(text: str) -> list[float]:
    response = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": [text], "truncate": True},
        timeout=30
    )
    response.raise_for_status()
    data = response.json()
    return data.get("embeddings", [data.get("embedding")])[0]

# 2. Semantic Search with Metadata Filter
query_text = "graph sparsity and pebble game algorithms"
query_vector = get_embedding(query_text)

results = collection.query(
    query_embeddings=[query_vector],
    n_results=5,
    # Optional metadata filtering:
    where={"categories": {"$contains": "math.CO"}},
    include=["documents", "metadatas", "distances"]
)

# 3. Parse and Use Results
for i in range(len(results["ids"][0])):
    doc_id = results["ids"][0][i]
    distance = results["distances"][0][i]
    metadata = results["metadatas"][0][i]
    
    # Parse stringified JSON fields
    authors_parsed = json.loads(metadata.get("authors_parsed", "[]"))
    versions = json.loads(metadata.get("versions", "[]"))
    
    print(f"\n--- Result #{i+1} (Distance: {distance:.4f}) ---")
    print(f"ID: {doc_id}")
    print(f"Title: {metadata.get('title')}")
    print(f"Categories: {metadata.get('categories')}")
    print(f"Parsed Authors: {authors_parsed}")
```

---

### 4.2 JavaScript / TypeScript Example (Node.js / Web App)

```typescript
import { ChromaClient } from "chromadb";

const client = new ChromaClient({ path: "http://localhost:5050" });

async function searchArxiv(queryText: string) {
  // 1. Get embedding from Ollama
  const embedRes = await fetch("http://localhost:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "embeddinggemma",
      input: [queryText],
      truncate: true,
    }),
  });
  const embedData = await embedRes.json();
  const queryEmbedding = embedData.embeddings?.[0] || embedData.embedding;

  // 2. Query Chroma
  const collection = await client.getCollection({ name: "arxiv_embeddings" });
  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: 5,
  });

  // 3. Process metadata
  return results.ids[0].map((id, index) => {
    const meta = results.metadatas[0][index] as Record<string, any>;
    return {
      id,
      title: meta.title,
      abstract: meta.abstract,
      categories: meta.categories,
      authorsParsed: meta.authors_parsed ? JSON.parse(meta.authors_parsed) : [],
      versions: meta.versions ? JSON.parse(meta.versions) : [],
    };
  });
}
```

---

### 4.3 Direct HTTP / cURL Example

#### 1. Generate Query Vector via Ollama
```bash
curl -s http://localhost:11434/api/embed -d '{
  "model": "embeddinggemma",
  "input": ["quantum chromodynamics diphoton production"],
  "truncate": true
}'
```

#### 2. Query Chroma Collection via REST API
```bash
# Get Collection ID
COLLECTION_ID=$(curl -s "http://localhost:5050/api/v1/collections/arxiv_embeddings" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

# Query Nearest Neighbors
curl -X POST "http://localhost:5050/api/v1/collections/${COLLECTION_ID}/query" \
  -H "Content-Type: application/json" \
  -d '{
    "query_embeddings": [[<VECTOR_FLOATS_HERE>]],
    "n_results": 5,
    "include": ["documents", "metadatas", "distances"]
  }'
```

---

## 5. How to Ingest Additional Records

When writing new data into `arxiv_embeddings`, ensure data adheres to the exact normalization and document structure rules:

```python
import json
import chromadb
import requests

def normalize_metadata_value(value):
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def record_to_metadata(record: dict) -> dict:
    metadata = {}
    for key, value in record.items():
        val = normalize_metadata_value(value)
        if val is not None:
            metadata[key] = val
    return metadata

def ingest_records(records: list[dict]):
    client = chromadb.HttpClient(host="localhost", port=5050)
    collection = client.get_or_create_collection(name="arxiv_embeddings")

    ids = []
    documents = []
    metadatas = []
    texts_to_embed = []

    for idx, rec in enumerate(records):
        rec_id = str(rec.get("id") or f"gen-{idx}")
        title = str(rec.get("title") or "").strip()
        abstract = str(rec.get("abstract") or "").strip()
        
        # Build Document
        if title and abstract:
            doc = f"Title: {title}\n\nAbstract: {abstract}"
        elif title:
            doc = f"Title: {title}"
        else:
            doc = abstract
            
        ids.append(rec_id)
        documents.append(doc)
        metadatas.append(record_to_metadata(rec))
        texts_to_embed.append(doc)

    # Generate Embeddings via Ollama
    res = requests.post(
        "http://localhost:11434/api/embed",
        json={"model": "embeddinggemma", "input": texts_to_embed, "truncate": True},
        timeout=120
    ).json()
    embeddings = res.get("embeddings")

    # Add to Chroma
    collection.add(
        ids=ids,
        documents=documents,
        embeddings=embeddings,
        metadatas=metadatas
    )
```

---

## 6. Integration Best Practices & Constraints

1. **Embedding Dimension & Model Matching**: Always use `embeddinggemma` with the same input structure (`Title: <title>\n\nAbstract: <abstract>`). Mismatched models or input prefixes will yield inaccurate distance calculations.
2. **Metadata Types**: Never send nested Python dictionaries or lists directly in `metadatas`. Always serialize them to JSON strings using `json.dumps()` as demonstrated.
3. **Null Values**: Do not pass `None` / `null` values inside `metadatas`. Omit those keys from the metadata dict before passing to Chroma.
4. **Batch Sizes**: For batch ingestions or bulk queries, keep batch sizes between **50 and 200 items** (or under 5MB per HTTP request) to avoid request timeouts or memory spikes.
5. **Distance Metrics**: By default, Chroma uses L2/Squared L2 Euclidean distance unless configured otherwise. Smaller distance values mean higher similarity.
