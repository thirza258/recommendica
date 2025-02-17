from django.db import models

class ResearchInfo(models.Model):
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=100)
    summary = models.TextField()
    authors = models.CharField(max_length=255)  # If storing names as a comma-separated string

    def __str__(self):
        return self.title
