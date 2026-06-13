import uuid

import chromadb
from openai import OpenAI
from django.conf import settings
from math import ceil
from typing import List, Dict, Any


import logging

logger = logging.getLogger(__name__)

COLLECTION_NAME = "arxiv_collection"

def get_chroma_client(collection_name: str):
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    return client.get_collection(name=COLLECTION_NAME, embedding_function=None)

def get_client():
    return chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)

def create_chroma_collection(collection_name: str):
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    try:
        collection = client.create_collection(name=COLLECTION_NAME, embedding_function=None)
        logger.info(f"Created ChromaDB collection: {COLLECTION_NAME}")
        return collection
    except chromadb.errors.CollectionAlreadyExistsError:
        logger.warning(f"Collection already exists: {COLLECTION_NAME}, retrieving existing collection.")
        return client.get_collection(name=COLLECTION_NAME, embedding_function=None)