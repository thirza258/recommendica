"""
Tests for SEO endpoints: robots.txt, sitemap.xml, sitemap-courses.xml, sitemap-topics.xml, and sitemap-index.xml.
"""

import xml.etree.ElementTree as ET
from django.test import SimpleTestCase, Client


class TestSeoEndpoints(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_robots_txt_returns_ok_and_lists_all_sitemaps(self):
        response = self.client.get("/robots.txt")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/plain", response["Content-Type"])
        content = response.content.decode("utf-8")
        self.assertIn("Allow: /sitemap.xml", content)
        self.assertIn("Allow: /sitemap-courses.xml", content)
        self.assertIn("Allow: /sitemap-topics.xml", content)
        self.assertIn("Allow: /sitemap-index.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.tech/sitemap.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.tech/sitemap-courses.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.tech/sitemap-topics.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.tech/sitemap-index.xml", content)

    def test_sitemap_xml_valid_and_complete(self):
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response["Content-Type"])

        root = ET.fromstring(response.content)
        # Check XML namespace
        self.assertTrue(root.tag.endswith("urlset"))

        namespaces = {
            "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
            "image": "http://www.google.com/schemas/sitemap-image/1.1",
            "xhtml": "http://www.w3.org/1999/xhtml",
        }

        urls = [elem.text for elem in root.findall("sm:url/sm:loc", namespaces)]
        self.assertEqual(len(urls), 53)

        expected_urls = [
            # Core Application
            "https://recommendica.nevatal.tech/",
            "https://recommendica.nevatal.tech/search",
            "https://recommendica.nevatal.tech/courses",
            # Sections
            "https://recommendica.nevatal.tech/disciplines",
            "https://recommendica.nevatal.tech/methodology",
            "https://recommendica.nevatal.tech/evidence-demo",
            "https://recommendica.nevatal.tech/comparison",
            "https://recommendica.nevatal.tech/faq",
            # Disciplines
            "https://recommendica.nevatal.tech/topics/ai-systems",
            "https://recommendica.nevatal.tech/topics/biomedicine",
            "https://recommendica.nevatal.tech/topics/climate-energy",
            "https://recommendica.nevatal.tech/topics/physics-materials",
            "https://recommendica.nevatal.tech/topics/neuroscience",
            "https://recommendica.nevatal.tech/topics/economics-quant",
            # Curated Inquiries
            "https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts",
            "https://recommendica.nevatal.tech/search?q=retrieval-augmented-architectures-hallucination-mitigation",
            "https://recommendica.nevatal.tech/search?q=climate-change-and-public-health",
            # Courses & Lessons
            "https://recommendica.nevatal.tech/courses/create-research",
            "https://recommendica.nevatal.tech/courses/create-research/research-question",
            "https://recommendica.nevatal.tech/courses/create-research/literature-review",
            "https://recommendica.nevatal.tech/courses/create-research/research-design",
            "https://recommendica.nevatal.tech/courses/create-research/project-proposal",
            "https://recommendica.nevatal.tech/courses/research-step-by-step",
            "https://recommendica.nevatal.tech/courses/research-step-by-step/plan-and-pilot",
            "https://recommendica.nevatal.tech/courses/research-step-by-step/collect-and-organize",
            "https://recommendica.nevatal.tech/courses/research-step-by-step/analyze-and-interpret",
            "https://recommendica.nevatal.tech/courses/research-step-by-step/write-and-share",
            "https://recommendica.nevatal.tech/courses/website-tutorial",
            "https://recommendica.nevatal.tech/courses/website-tutorial/first-search",
            "https://recommendica.nevatal.tech/courses/website-tutorial/understand-answers",
            "https://recommendica.nevatal.tech/courses/website-tutorial/inspect-sources",
            "https://recommendica.nevatal.tech/courses/website-tutorial/refine-search",
            "https://recommendica.nevatal.tech/courses/read-research",
            "https://recommendica.nevatal.tech/courses/read-research/map-the-paper",
            "https://recommendica.nevatal.tech/courses/read-research/evaluate-methods",
            "https://recommendica.nevatal.tech/courses/read-research/interpret-results",
            "https://recommendica.nevatal.tech/courses/read-research/notes-and-citations",
        ]

        for expected in expected_urls:
            self.assertIn(expected, urls)

        images = root.findall("sm:url/image:image/image:loc", namespaces)
        self.assertTrue(len(images) > 0)

        alts = root.findall("sm:url/xhtml:link", namespaces)
        self.assertTrue(len(alts) > 0)

    def test_sitemap_courses_xml_valid(self):
        response = self.client.get("/sitemap-courses.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response["Content-Type"])

        root = ET.fromstring(response.content)
        self.assertTrue(root.tag.endswith("urlset"))

        namespaces = {
            "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
        }
        urls = [elem.text for elem in root.findall("sm:url/sm:loc", namespaces)]
        self.assertEqual(len(urls), 21)
        self.assertIn("https://recommendica.nevatal.tech/courses", urls)
        self.assertIn("https://recommendica.nevatal.tech/courses/create-research/research-question", urls)
        self.assertNotIn("https://recommendica.nevatal.tech/", urls)
        self.assertNotIn("https://recommendica.nevatal.tech/search", urls)

    def test_sitemap_topics_xml_valid(self):
        response = self.client.get("/sitemap-topics.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response["Content-Type"])

        root = ET.fromstring(response.content)
        self.assertTrue(root.tag.endswith("urlset"))

        namespaces = {
            "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
        }
        urls = [elem.text for elem in root.findall("sm:url/sm:loc", namespaces)]
        self.assertEqual(len(urls), 26)
        self.assertIn("https://recommendica.nevatal.tech/disciplines", urls)
        self.assertIn("https://recommendica.nevatal.tech/topics/ai-systems", urls)
        self.assertIn("https://recommendica.nevatal.tech/search?q=scaling-laws-sparse-mixture-of-experts", urls)
        self.assertNotIn("https://recommendica.nevatal.tech/", urls)
        self.assertNotIn("https://recommendica.nevatal.tech/courses", urls)

    def test_sitemap_index_xml_valid(self):
        response = self.client.get("/sitemap-index.xml")
        self.assertEqual(response.status_code, 200)
        self.assertIn("application/xml", response["Content-Type"])

        root = ET.fromstring(response.content)
        self.assertTrue(root.tag.endswith("sitemapindex"))

        namespaces = {
            "sm": "http://www.sitemaps.org/schemas/sitemap/0.9",
        }
        locs = [elem.text for elem in root.findall("sm:sitemap/sm:loc", namespaces)]
        self.assertIn("https://recommendica.nevatal.tech/sitemap.xml", locs)
        self.assertIn("https://recommendica.nevatal.tech/sitemap-courses.xml", locs)
        self.assertIn("https://recommendica.nevatal.tech/sitemap-topics.xml", locs)
