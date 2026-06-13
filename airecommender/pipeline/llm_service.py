from langchain_openrouter import ChatOpenRouter
from django.conf import settings
from typing import Optional
from langchain_core import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
import logging
import json

logger = logging.getLogger(__name__)

class OpenRouterService():
    default_model = settings.DEFAULT_LLM_MODEL
    base_url = settings.OPENROUTER_BASE_URL
    
    def __init__(self, model: Optional[str] = None):
        if api_key is None:
            api_key = settings.OPENROUTER_API_KEY
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY not found in environment variables.")
        
        self.api_key = api_key
        self.model = model or self.default_model
        self.llm = self._build_llm(api_key=self.api_key, model=self.model)

    def _build_llm(self, api_key: str, model: Optional[str] = None):
        model_name = self.normalize_model(model)

        if ChatOpenRouter is not None:
            for key_name in ("api_key", "openai_api_key"):
                try:
                    return ChatOpenRouter(
                        model=model_name,
                        temperature=0,
                        **{key_name: api_key},
                    )
                except Exception:
                    continue

        base_kwargs = {
            "model": model_name,
            "temperature": 0,
        }

        for base_url_key in ("base_url", "openai_api_base"):
            for key_name in ("api_key", "openai_api_key"):
                try:
                    return ChatOpenAI(
                        **base_kwargs,
                        **{base_url_key: self.base_url, key_name: api_key},
                    )
                except Exception:
                    continue

        return ChatOpenAI(**base_kwargs)
    
    def coerce_text(self, response) -> str:
        if response is None:
            return ""

        if isinstance(response, str):
            return response

        if hasattr(response, "content"):
            content = response.content

            if isinstance(content, str):
                return content

            if isinstance(content, list):
                return "\n".join(
                    item.get("text", str(item))
                    for item in content
                )

            return str(content)

        return str(response)
    
    def ensure_json_response(
        self,
        response_text: str,
        response_schema_param=None,
    ) -> str:
        json.loads(response_text)
        return response_text

    def generate_response(
            self,
            prompt: str,
            api_key: Optional[str] = None,
            model: Optional[str] = None,
            system_instruction_string: str = "Answer this prompt make sure answer that",
            response_schema_param: Optional[list[str]] = None,
            response_mime_type_param: str = "application/json",
        ) -> str:
            try:
                
                instruction = self.build_response_instruction(
                    system_instruction_string,
                    response_schema_param,
                )
                response = self.llm.invoke(
                    [
                        SystemMessage(content=instruction),
                        HumanMessage(content=prompt),
                    ]
                )
                response_text = self.coerce_text(response)
                return self.ensure_json_response(response_text, response_schema_param)
            except Exception as e:
                logger.error(f"An error occurred during OpenRouter API call: {e}")
                raise 