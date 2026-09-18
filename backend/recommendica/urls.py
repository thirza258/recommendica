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
Allow: /sitemap-index.xml
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

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
Allow: /sitemap-index.xml
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

Sitemap: https://recommendica.nevatal.tech/sitemap.xml
Sitemap: https://recommendica.nevatal.tech/sitemap-courses.xml
Sitemap: https://recommendica.nevatal.tech/sitemap-index.xml
Host: https://recommendica.nevatal.tech
"""

SITEMAP_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <!-- Core Application & Landing -->
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

  <!-- Course: Create your first research project -->
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

  <!-- Course: Conduct research step by step -->
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

  <!-- Course: How to use Recommendica -->
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

  <!-- Course: How to read a research paper -->
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
</sitemapindex>
"""

def robots_txt_view(request):
    return HttpResponse(ROBOTS_TXT_CONTENT, content_type="text/plain; charset=utf-8")

def sitemap_xml_view(request):
    return HttpResponse(SITEMAP_XML_CONTENT, content_type="application/xml; charset=utf-8")

def sitemap_courses_xml_view(request):
    return HttpResponse(SITEMAP_COURSES_XML_CONTENT, content_type="application/xml; charset=utf-8")

def sitemap_index_xml_view(request):
    return HttpResponse(SITEMAP_INDEX_XML_CONTENT, content_type="application/xml; charset=utf-8")

urlpatterns = [
    path("robots.txt", robots_txt_view, name="robots-txt"),
    path("sitemap.xml", sitemap_xml_view, name="sitemap-xml"),
    path("sitemap-courses.xml", sitemap_courses_xml_view, name="sitemap-courses-xml"),
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
