from django.db import models
from pydantic import BaseModel, Field
from typing import List

class ResearchInfo(models.Model):
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=100)
    summary = models.TextField()
    authors = models.CharField(max_length=255)  # If storing names as a comma-separated string

    def __str__(self):
        return self.title
    
class ResearchReturn(BaseModel):
    title: str = Field(description="Title of the research")
    category: str = Field(description="Category of the research")
    summary: str = Field(description="Summary of the research")
    authors: str = Field(description="Authors of the research")
    
    def __str__(self):
        return self.title
    
class AIResponse(BaseModel):
    response: str = Field(description="AI response to the input prompt")
    research_results: List[ResearchReturn] = Field(description="List of relevant research results")
    
    
