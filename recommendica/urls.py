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
Disallow: /api/
Disallow: /admin/
Disallow: /schema/
Disallow: /docs/

Sitemap: https://recommendica.nevatal.tech/sitemap.xml
Host: https://recommendica.nevatal.tech
"""

SITEMAP_XML_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://recommendica.nevatal.tech/</loc>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://recommendica.nevatal.tech/" />
    <xhtml:link rel="alternate" hreflang="en" href="https://recommendica.nevatal.tech/" />
    <lastmod>2026-08-17T00:00:00+00:00</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>https://recommendica.nevatal.tech/og-image.png</image:loc>
      <image:title>Recommendica — Grounded Research Paper Recommendations</image:title>
      <image:caption>Find research papers that answer your question with grounded AI recommendations and faithfulness scoring.</image:caption>
    </image:image>
  </url>
</urlset>
"""

def robots_txt_view(request):
    return HttpResponse(ROBOTS_TXT_CONTENT, content_type="text/plain; charset=utf-8")

def sitemap_xml_view(request):
    return HttpResponse(SITEMAP_XML_CONTENT, content_type="application/xml; charset=utf-8")

urlpatterns = [
    path("robots.txt", robots_txt_view, name="robots-txt"),
    path("sitemap.xml", sitemap_xml_view, name="sitemap-xml"),
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
