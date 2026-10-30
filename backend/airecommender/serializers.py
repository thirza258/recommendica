from rest_framework import serializers

from . import donations
from .assistant import ASSISTANT_DOC_LIMIT
from .models import ResearchInfo
from .pipeline.modes import DEFAULT_SEARCH_MODE, SearchMode


class RecommendationRequestSerializer(serializers.Serializer):
    input_prompt = serializers.CharField(trim_whitespace=True)
    mode = serializers.ChoiceField(
        choices=[mode.value for mode in SearchMode], default=DEFAULT_SEARCH_MODE
    )


class AssistantRequestSerializer(serializers.Serializer):
    """
    Body of ``POST /assistant/``.

    The editor sends the paper's current LaTeX (or plain text) plus the
    question.  ``history`` is the visible chat so far; each turn is capped
    so one long conversation cannot blow the model's context on its own.
    """

    question = serializers.CharField(max_length=2000, trim_whitespace=True)
    document_title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    document_text = serializers.CharField(
        max_length=ASSISTANT_DOC_LIMIT, required=False, allow_blank=True
    )
    history = serializers.ListField(
        child=serializers.DictField(), max_length=12, required=False, default=list
    )

    def validate_history(self, value):
        for index, turn in enumerate(value):
            role = turn.get("role")
            content = turn.get("content")
            if role not in ("user", "assistant"):
                raise serializers.ValidationError(
                    f"history[{index}]: role must be 'user' or 'assistant'."
                )
            if not isinstance(content, str):
                raise serializers.ValidationError(
                    f"history[{index}]: content must be a string."
                )
        return value

class ResearchInfoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResearchInfo
        fields = '__all__'  # Or specify fields explicitly


class DonationCheckoutSerializer(serializers.Serializer):
    """
    Validates the body of ``POST /donate/checkout/``.

    The endpoint is public and creates a resource at Paddle on every call, so
    the amount is bounded and the currency allowlisted here — before anything
    is sent upstream.  ``max_digits``/``decimal_places`` also stop a caller from
    sending an amount with enough precision to overflow the conversion to minor
    units.
    """

    amount = serializers.DecimalField(max_digits=12, decimal_places=3)
    currency = serializers.CharField(max_length=3, required=False)
    message = serializers.CharField(max_length=280, required=False, allow_blank=True)

    def __init__(self, *args, **kwargs):
        # The Paddle config carries the bounds and the currency allowlist. It is
        # read once per serializer so a request sees one consistent view of it.
        self.paddle_config = kwargs.pop("paddle_config", None) or donations.get_config()
        super().__init__(*args, **kwargs)

    def validate_currency(self, value):
        currency = value.strip().upper()
        if currency not in self.paddle_config.currencies:
            raise serializers.ValidationError(
                f"Unsupported currency. Choose one of: {', '.join(self.paddle_config.currencies)}."
            )
        return currency

    def validate_amount(self, value):
        config = self.paddle_config
        if value < config.min_amount:
            raise serializers.ValidationError(f"The minimum donation is {config.min_amount}.")
        if value > config.max_amount:
            raise serializers.ValidationError(f"The maximum donation is {config.max_amount}.")
        return value

    def validate(self, attrs):
        attrs.setdefault("currency", self.paddle_config.default_currency)
        attrs["message"] = attrs.get("message", "").strip()
        # Precision is currency-dependent (JPY has no minor unit at all), so the
        # amount can only be converted once the currency is known.
        try:
            attrs["amount_minor"] = donations.to_minor_units(attrs["amount"], attrs["currency"])
        except donations.DonationAmountInvalid as exc:
            raise serializers.ValidationError({"amount": exc.user_message()}) from exc
        if attrs["amount_minor"] <= 0:
            raise serializers.ValidationError({"amount": "The donation amount must be positive."})
        return attrs
