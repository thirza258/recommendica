import os
import json
import chromadb
from chromadb.config import Settings
from langchain_ollama import OllamaEmbeddings

COLLECTION_NAME = "arxiv_collection"


class RAGIndex:
    def __init__(self):
        self.embeddings = OllamaEmbeddings(
            model="embeddinggemma",
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        )

        self.chroma_client = None
        self.collection = None
        self._init_chroma_client()

    def _init_chroma_client(self):
        """Initialize ChromaDB client — remote if host/port are set, otherwise in-memory."""
        RE_CHROMA_HOST = os.getenv("RE_CHROMA_HOST")
        RE_CHROMA_PORT = os.getenv("RE_CHROMA_PORT")

        if RE_CHROMA_HOST and RE_CHROMA_PORT:
            self.chroma_client = chromadb.HttpClient(
                host=RE_CHROMA_HOST,
                port=int(RE_CHROMA_PORT),
                settings=Settings(anonymized_telemetry=False),
            )
        else:
            # Fallback to in-memory client for local development
            self.chroma_client = chromadb.EphemeralClient(
                settings=Settings(anonymized_telemetry=False),
            )

        self.collection = self.chroma_client.get_or_create_collection(
            name=COLLECTION_NAME,
        )

    def load_data(self):
        """Load documents from the database and index them in ChromaDB."""
        try:
            try:
                from .models import ResearchInfo
                from .serializers import ResearchInfoSerializer
            except Exception:
                ResearchInfo = None
                ResearchInfoSerializer = None

            if ResearchInfo is None:
                return

            research_info = ResearchInfo.objects.all()
            if not research_info.exists():
                return

            research_info_serializer = ResearchInfoSerializer(research_info, many=True).data

            document_texts = [json.dumps(i) for i in research_info_serializer]
            doc_ids = [str(i) for i in range(len(document_texts))]

            doc_embeddings = self.embeddings.embed_documents(document_texts)

            # Clear existing documents before re-adding
            existing_ids = self.collection.get()["ids"]
            if existing_ids:
                self.collection.delete(ids=existing_ids)

            # Add documents with their embeddings to ChromaDB
            self.collection.add(
                documents=document_texts,
                embeddings=doc_embeddings,
                ids=doc_ids,
            )
        except Exception as e:
            raise Exception(f"Error loading data: {e}")

    def retrieve_documents(self, query, k=5):
        try:
            if self.collection is None or self.collection.count() == 0:
                return []

            query_embedding = self.embeddings.embed_query(query)

            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=k,
            )

            docs = []

            for i in range(len(results["ids"][0])):
                docs.append({
                    "id": results["ids"][0][i],
                    "document": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i]
                    if "distances" in results
                    else None,
                })

            return docs

        except Exception as e:
            raise Exception(f"Error retrieving documents: {e}")


# Create a global instance to be used throughout the app
rag_index = RAGIndex()
