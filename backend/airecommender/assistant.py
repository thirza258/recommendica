"""
Prompt construction for the paper assistant.

The Write editor's assistant answers questions about the paper being edited
and, on request, rewrites it.  Both jobs run through the same OpenRouter
stream as everything else; the protocol between the model and the editor is
just text: an edit is the COMPLETE revised document in a single fenced
```latex block, which the frontend extracts and offers to apply.
"""

from django.conf import settings

#: Longest ``document_text`` accepted from a client.  Kept in sync with the
#: serializer (DRF reads ``max_length`` once at import) and roughly the
#: context a free OpenRouter model can handle alongside an edit rewrite.
ASSISTANT_DOC_LIMIT = int(getattr(settings, "MAX_ASSISTANT_DOC_CHARS", 60000))

#: Longest single past turn replayed into the prompt.
ASSISTANT_HISTORY_TURN_LIMIT = 4000

ASSISTANT_SYSTEM_PROMPT = """\
You are an academic writing assistant embedded in a paper editor. The user's \
current paper is provided inside <document> tags, followed by the conversation \
so far and their new request.

Rules:
1. Questions about the paper: answer from the document only, in 150 words or \
fewer. Summarize and refer to sections in prose. Never re-emit LaTeX code \
unless the user asks you to change the paper.
2. Requests to change the paper: reply with ONE short sentence describing the \
change, then output the COMPLETE revised document in a single fenced code \
block that opens with ```latex. Include the full preamble, every \\section, \
all \\label keys, the existing \\cite keys (never invent citations), and any \
\\bibliography, \\addbibresource, \\input or \\includegraphics lines exactly \
as they were. No placeholders, no "..." omissions, and no changes beyond \
what was requested.
3. If the document looks truncated, work with the visible part and say so \
in your reply sentence.
4. If the request is unrelated to the paper, answer briefly and do not \
re-emit the document.
"""


def build_prompt(
    document_title: str,
    document_text: str,
    history: list[dict],
    question: str,
) -> str:
    """Flatten document, replayed turns and the new request into one message.

    The shared LLM service sends exactly one system message and one human
    message per call, so the conversation history has to be inlined here.
    """
    parts: list[str] = ['Paper "' + (document_title or "Untitled paper").strip() + '":']
    parts.append("<document>")
    parts.append(document_text or "(The paper is empty.)")
    parts.append("</document>")

    if history:
        lines = []
        for turn in history:
            role = "User" if turn.get("role") == "user" else "Assistant"
            text = str(turn.get("content", ""))[:ASSISTANT_HISTORY_TURN_LIMIT]
            lines.append(f"{role}: {text}")
        parts.append("Conversation so far:\n" + "\n".join(lines))

    parts.append("New request: " + question)
    return "\n\n".join(parts)
