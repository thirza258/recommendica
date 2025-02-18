import faiss
import numpy as np
import json
from langchain.docstore.document import Document
from langchain.embeddings import OpenAIEmbeddings
from .models import ResearchInfo  # Adjust based on your app structure
from .serializers import ResearchInfoSerializer  # Your Django serializer

class RAGIndex:
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(model="text-embedding-3-large")
        self.faiss_index = None
        self.documents = []
        self.load_data()

    def load_data(self):
        """Load and index documents at startup"""
        research_info = ResearchInfo.objects.all()
        research_info_serializer = ResearchInfoSerializer(research_info, many=True).data

        document_texts = [json.dumps(i) for i in research_info_serializer]
        self.documents = [Document(page_content=text) for text in document_texts]

        # Create FAISS index
        doc_embeddings = self.embeddings.embed_documents(document_texts)
        embedding_dim = len(doc_embeddings[0])
        self.faiss_index = faiss.IndexFlatL2(embedding_dim)

        # Add embeddings to FAISS index
        self.faiss_index.add(np.array(doc_embeddings).astype("float32"))

    def retrieve_documents(self, query, k=2):
        """Retrieve relevant documents"""
        if not self.faiss_index:
            return []
        
        query_embedding = self.embeddings.embed_query(query)
        query_embedding = np.array(query_embedding).reshape(1, -1).astype("float32")

        distances, indices = self.faiss_index.search(query_embedding, k)
        return [self.documents[i].page_content for i in indices[0] if i != -1]

# Create a global instance to be used throughout the app
rag_index = RAGIndex()
