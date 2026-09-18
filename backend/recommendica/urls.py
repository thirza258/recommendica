"""
URL configuration for recommendica project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
"""
from django.contrib import admin
from django.urls import path, include
from django.http import HttpResponse
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

ROBOTS_TXT_CONTENT = """# ==============================================================================
# Recommendica — Robots Exclusion Protocol
# https://recommendica.nevatal.tech/
# ==============================================================================

# Search Engine Crawlers (Google, Bing, DuckDuckGo, Apple, Yandex, Baidu, etc.)
User-agent: Googlebot
User-agent: Googlebot-Image
User-agent: Googlebot-News
User-agent: Bingbot
User-agent: Slurp
User-agent: DuckDuckBot
User-agent: Baiduspider
User-agent: YandexBot
User-agent: Applebot
User-agent: msnbot
User-agent: Qwantify
Allow: /
Allow: /assets/
Allow: /favicon.svg
Allow: /og-image.png
Allow: /apple-touch-icon.png
Allow: /icon-512.png
Allow: /site.webmanifest
Allow: /sitemap.xml
Allow: /sitemap-courses.xml
Allow: /sitemap-topics.xml
Allow: /sitemap-index.xml
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

# AI Search & Discovery Agents (OpenAI, Anthropic, Perplexity, Cohere, etc.)
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-Web
User-agent: PerplexityBot
User-agent: CCBot
User-agent: Google-Extended
User-agent: cohere-ai
User-agent: Omgilibot
User-agent: FacebookBot
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

# Default policy for all crawlers
User-agent: *
Allow: /
Allow: /assets/
Allow: /favicon.svg
Allow: /og-image.png
Allow: /apple-touch-icon.png
Allow: /icon-512.png
Allow: /site.webmanifest
Allow: /sitemap.xml
Allow: /sitemap-courses.xml
Allow: /sitemap-topics.xml
Allow: /sitemap-index.xml
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

# Sitemap & Host
Sitemap: https://recommendica.nevatal.tech/sitemap.xml
Sitemap: https://recommendica.nevatal.tech/sitemap-courses.xml
Sitemap: https://recommendica.nevatal.tech/sitemap-topics.xml
Sitemap: https://recommendica.nevatal.tech/sitemap-index.xml
Host: https://recommendica.nevatal.tech
"""

SITEMAP_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <!-- ── Core Application & Landing ──────────────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Recommendica — Grounded Research Paper Recommendations</image:title>
      <image:caption>Find research papers that answer your question with grounded AI recommendations and faithfulness scoring.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Search Research Papers — Recommendica</image:title>
      <image:caption>Query research papers and live arXiv literature with AI relevance grading and verified citations.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Research Courses &amp; Literature Discovery Tutorials — Recommendica</image:title>
      <image:caption>Free, self-paced research courses on writing questions, literature reviews, evaluating methods, and paper reading.</image:caption>
    </image:image>
  </url>

  <!-- ── Informational & Architecture Sections ─────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/disciplines</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/disciplines" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/disciplines" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Curated Scientific Disciplines — Recommendica</image:title>
      <image:caption>Peer-reviewed literature and preprints across AI, biomedicine, physics, climate science, neuroscience, and economics.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/methodology</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/methodology" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/methodology" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Four-Stage Grounded Retrieval Pipeline — Recommendica</image:title>
      <image:caption>Architecture detailing multi-vector query expansion, autonomous relevance filtration, clustered synthesis, and claim verification.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/evidence-demo</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/evidence-demo" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/evidence-demo" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Interactive Evidence Inspector &amp; Synthesis Demo — Recommendica</image:title>
      <image:caption>Sample inquiry synthesis, claim-level grounding audit, and graded candidate paper evidence.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/comparison</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/comparison" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/comparison" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/faq</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/faq" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/faq" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>

  <!-- ── Scientific Disciplines (6 Domains) ────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/topics/ai-systems</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/ai-systems" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/ai-systems" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Artificial Intelligence &amp; Machine Learning Literature — Recommendica</image:title>
      <image:caption>Scaling laws, sparse mixture-of-experts, retrieval-augmented grounding, and alignment algorithms.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/biomedicine</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/biomedicine" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/biomedicine" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Biomedicine &amp; Genomics Research — Recommendica</image:title>
      <image:caption>Single-cell transcriptomics, CRISPR gene editing, mRNA delivery mechanisms, and targeted therapeutics.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/climate-energy</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/climate-energy" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/climate-energy" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Climate &amp; Energy Systems Research — Recommendica</image:title>
      <image:caption>Direct air carbon capture, perovskite photovoltaics, solid-state battery electrolytes, and grid modeling.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/physics-materials</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/physics-materials" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/physics-materials" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Physics &amp; Quantum Materials Research — Recommendica</image:title>
      <image:caption>Topological superconductivity, neutral atom quantum processors, high-entropy alloys, and photonics.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/neuroscience</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/neuroscience" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/neuroscience" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Neuroscience &amp; Cognition Research — Recommendica</image:title>
      <image:caption>Neural decoding, cortical microcircuit modeling, hippocampal replay, and synaptic plasticity.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/economics-quant</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/economics-quant" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/economics-quant" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Economics &amp; Social Science Research — Recommendica</image:title>
      <image:caption>Causal inference with synthetic controls, algorithmic mechanism design, and high-frequency econometrics.</image:caption>
    </image:image>
  </url>

  <!-- ── Curated Research Inquiries ────────────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=climate-change-and-public-health</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=climate-change-and-public-health" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=climate-change-and-public-health" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>

  <!-- ── Course 1: Create your first research project ───────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/research-question</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/research-question" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/research-question" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/literature-review</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/literature-review" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/literature-review" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/research-design</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/research-design" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/research-design" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/project-proposal</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/project-proposal" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/project-proposal" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 2: Conduct research step by step ────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 3: How to use Recommendica ──────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/first-search</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/first-search" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/first-search" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/refine-search</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/refine-search" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/refine-search" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 4: How to read a research paper ─────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/map-the-paper</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/map-the-paper" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/map-the-paper" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/evaluate-methods</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/evaluate-methods" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/evaluate-methods" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/interpret-results</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/interpret-results" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/interpret-results" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/notes-and-citations</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/notes-and-citations" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/notes-and-citations" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
"""

SITEMAP_COURSES_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <!-- ── Course Catalog ────────────────────────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Research Courses &amp; Literature Discovery Tutorials — Recommendica</image:title>
      <image:caption>Free, self-paced research courses on writing questions, literature reviews, evaluating methods, and paper reading.</image:caption>
    </image:image>
  </url>

  <!-- ── Course 1: Create your first research project ───────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/research-question</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/research-question" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/research-question" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/literature-review</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/literature-review" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/literature-review" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/research-design</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/research-design" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/research-design" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/create-research/project-proposal</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/create-research/project-proposal" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/create-research/project-proposal" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 2: Conduct research step by step ────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 3: How to use Recommendica ──────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/first-search</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/first-search" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/first-search" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/website-tutorial/refine-search</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/website-tutorial/refine-search" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/website-tutorial/refine-search" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>

  <!-- ── Course 4: How to read a research paper ─────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/map-the-paper</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/map-the-paper" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/map-the-paper" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/evaluate-methods</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/evaluate-methods" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/evaluate-methods" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/interpret-results</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/interpret-results" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/interpret-results" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/courses/read-research/notes-and-citations</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/courses/read-research/notes-and-citations" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/courses/read-research/notes-and-citations" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>
"""

SITEMAP_TOPICS_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <!-- ── Scientific Disciplines Hub ────────────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/disciplines</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/disciplines" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/disciplines" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Scientific Disciplines &amp; Research Taxonomies — Recommendica</image:title>
      <image:caption>Explore research papers across AI, biomedicine, climate systems, quantum physics, neuroscience, and quantitative economics.</image:caption>
    </image:image>
  </url>

  <!-- ── Domain Taxonomies (6 Disciplines) ─────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/topics/ai-systems</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/ai-systems" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/ai-systems" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Artificial Intelligence &amp; Machine Learning Literature — Recommendica</image:title>
      <image:caption>Scaling laws, sparse mixture-of-experts, retrieval-augmented grounding, and alignment algorithms.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/biomedicine</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/biomedicine" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/biomedicine" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Biomedicine &amp; Genomics Research — Recommendica</image:title>
      <image:caption>Single-cell transcriptomics, CRISPR gene editing, mRNA delivery mechanisms, and targeted therapeutics.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/climate-energy</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/climate-energy" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/climate-energy" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Climate &amp; Energy Systems Research — Recommendica</image:title>
      <image:caption>Direct air carbon capture, perovskite photovoltaics, solid-state battery electrolytes, and grid modeling.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/physics-materials</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/physics-materials" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/physics-materials" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Physics &amp; Quantum Materials Research — Recommendica</image:title>
      <image:caption>Topological superconductivity, neutral atom quantum processors, high-entropy alloys, and photonics.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/neuroscience</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/neuroscience" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/neuroscience" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Neuroscience &amp; Cognition Research — Recommendica</image:title>
      <image:caption>Neural decoding, cortical microcircuit modeling, hippocampal replay, and synaptic plasticity.</image:caption>
    </image:image>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/topics/economics-quant</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/topics/economics-quant" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/topics/economics-quant" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Economics &amp; Social Science Research — Recommendica</image:title>
      <image:caption>Causal inference with synthetic controls, algorithmic mechanism design, and high-frequency econometrics.</image:caption>
    </image:image>
  </url>

  <!-- ── Curated Research Inquiries ────────────────────────────────────── -->
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=sample-efficiency-reinforcement-learning-human-feedback" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=crispr-cas9-off-target-reduction-prime-editing" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=lipid-nanoparticle-mrna-delivery-efficiency" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=single-cell-rna-sequencing-batch-effect-correction" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=direct-air-carbon-capture-thermodynamic-limits" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=perovskite-photovoltaic-cell-stability-capping-layers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=solid-state-battery-electrolytes-lithium-conductivity" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=nickelate-heterostructures-unconventional-superconductivity" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=surface-code-quantum-error-correction-thresholds" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=2d-transition-metal-dichalcogenides-phase-transitions" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=hippocampal-replay-memory-consolidation-non-rem-sleep" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=neural-decoding-motor-cortex-prostheses-accuracy" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=biologically-plausible-credit-assignment-spiking-networks" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=synthetic-controls-staggered-treatment-adoption" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=incentive-compatible-automated-market-makers" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=algorithmic-collusion-multi-agent-pricing-models" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
  <url>
    <loc>https://recommendica.nevatal.tech/search?q=climate-change-and-public-health</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/search?q=climate-change-and-public-health" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/search?q=climate-change-and-public-health" />
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>
</urlset>
"""

SITEMAP_INDEX_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://recommendica.nevatal.tech/sitemap.xml</loc>
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://recommendica.nevatal.tech/sitemap-courses.xml</loc>
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://recommendica.nevatal.tech/sitemap-topics.xml</loc>
    <lastmod>2026-09-18T00:00:00+00:00</lastmod>
  </sitemap>
</sitemapindex>
"""

def robots_txt_view(request):
    return HttpResponse(ROBOTS_TXT_CONTENT, content_type="text/plain; charset=utf-8")

def sitemap_xml_view(request):
    return HttpResponse(SITEMAP_XML_CONTENT, content_type="application/xml; charset=utf-8")

def sitemap_courses_xml_view(request):
    return HttpResponse(SITEMAP_COURSES_XML_CONTENT, content_type="application/xml; charset=utf-8")

def sitemap_topics_xml_view(request):
    return HttpResponse(SITEMAP_TOPICS_XML_CONTENT, content_type="application/xml; charset=utf-8")

def sitemap_index_xml_view(request):
    return HttpResponse(SITEMAP_INDEX_XML_CONTENT, content_type="application/xml; charset=utf-8")

urlpatterns = [
    path("robots.txt", robots_txt_view, name="robots-txt"),
    path("sitemap.xml", sitemap_xml_view, name="sitemap-xml"),
    path("sitemap-courses.xml", sitemap_courses_xml_view, name="sitemap-courses-xml"),
    path("sitemap-topics.xml", sitemap_topics_xml_view, name="sitemap-topics-xml"),
    path("sitemap-index.xml", sitemap_index_xml_view, name="sitemap-index-xml"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("airecommender.urls"), name="api-v1"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "docs/",
        SpectacularSwaggerView.as_view(
            template_name="swagger-ui.html", url_name="schema"
        ),
        name="swagger-ui",
    ),    
]
