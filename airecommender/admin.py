from django.contrib import admin
from .models import Donation, ResearchInfo

# Register your models here.
admin.site.register(ResearchInfo)


@admin.register(Donation)
class DonationAdmin(admin.ModelAdmin):
    """
    Read-only by design: every field is owned by Paddle, and editing a donation
    here would only make the local row disagree with the provider's record.
    """

    list_display = ("paddle_transaction_id", "status", "amount_minor", "currency", "email", "created_at")
    list_filter = ("status", "currency")
    search_fields = ("paddle_transaction_id", "email")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
