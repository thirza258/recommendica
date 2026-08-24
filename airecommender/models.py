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
    
    


class Donation(models.Model):
    """
    One Paddle transaction opened from the donate button.

    A row is written when the transaction is created — before any money moves —
    so an abandoned checkout is visible as a ``draft`` row rather than absent.
    Everything after that is driven by webhooks, which Paddle retries: the
    Paddle transaction id is unique and updates are keyed on it, so a redelivery
    updates the same row instead of adding another.

    Amounts are stored in minor units (cents) as an integer.  Floats cannot
    represent money exactly, and this is the same unit Paddle sends, so no
    conversion happens on the way in or out of the database.
    """

    #: Paddle's transaction lifecycle, mirrored verbatim rather than mapped to
    #: our own vocabulary — a status we do not recognise is still worth storing.
    STATUS_DRAFT = "draft"
    STATUS_READY = "ready"
    STATUS_BILLED = "billed"
    STATUS_PAID = "paid"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_PAST_DUE = "past_due"

    paddle_transaction_id = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=32, default=STATUS_DRAFT)
    amount_minor = models.BigIntegerField(help_text="Amount in minor units (e.g. cents).")
    currency = models.CharField(max_length=3)
    # Usually blank: transaction webhooks identify the payer by customer_id
    # and only carry an email when the destination expands the customer.
    email = models.EmailField(blank=True, help_text="Payer email, when Paddle sends one.")
    message = models.CharField(max_length=280, blank=True)

    #: Webhooks arrive out of order and more than once. The event id makes a
    #: redelivery a no-op; the occurrence time stops a slow earlier event from
    #: overwriting the state a later one already applied.
    last_event_id = models.CharField(max_length=64, blank=True)
    last_event_type = models.CharField(max_length=64, blank=True)
    last_event_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status"])]

    def __str__(self):
        return f"{self.paddle_transaction_id} — {self.amount_minor} {self.currency} ({self.status})"
