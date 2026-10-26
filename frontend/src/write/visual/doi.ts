/**
 * Looks up BibTeX for a DOI or an arXiv identifier.
 *
 * DOI content negotiation at doi.org answers for both Crossref and DataCite
 * DOIs (arXiv papers have DataCite DOIs of the form 10.48550/arXiv.<id>), and
 * sends CORS headers, so the browser can ask directly. The Crossref API is a
 * fallback for journals whose agency does not negotiate BibTeX.
 */

export function doiFromInput(input: string): string | null {
  const value = input.trim();
  const arxiv = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|^)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i.exec(value);
  if (arxiv) return `10.48550/arXiv.${arxiv[1]}`;
  const doi = /(10\.\d{4,9}\/[^\s"<>]+)/.exec(value);
  return doi ? doi[1].replace(/[.,;)\]]+$/, "") : null;
}

function encodeDoi(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

async function request(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/x-bibtex; charset=utf-8" }, signal });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text.startsWith("@") ? text : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function fetchBibtex(input: string, signal?: AbortSignal): Promise<string> {
  const doi = doiFromInput(input);
  if (!doi) throw new Error("Enter a DOI such as 10.1038/nature14539 or an arXiv id such as 1706.03762.");
  const bibtex =
    (await request(`https://doi.org/${encodeDoi(doi)}`, signal)) ??
    (await request(`https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`, signal));
  if (!bibtex) throw new Error(`No citation data was found for ${doi}. Check the identifier, or paste the BibTeX instead.`);
  return bibtex;
}
