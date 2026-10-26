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
        # Every crawler group allows the courses and the paper editor explicitly.
        self.assertEqual(content.count("Allow: /courses\n"), 3)
        self.assertEqual(content.count("Allow: /write\n"), 3)
        self.assertIn("Sitemap: https://recommendica.nevatal.id/sitemap.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.id/sitemap-courses.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.id/sitemap-topics.xml", content)
        self.assertIn("Sitemap: https://recommendica.nevatal.id/sitemap-index.xml", content)

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
        self.assertEqual(len(urls), 54)

        expected_urls = [
            # Core Application
            "https://recommendica.nevatal.id/",
            "https://recommendica.nevatal.id/search",
            "https://recommendica.nevatal.id/courses",
            "https://recommendica.nevatal.id/write",
            # Sections
            "https://recommendica.nevatal.id/disciplines",
            "https://recommendica.nevatal.id/methodology",
            "https://recommendica.nevatal.id/evidence-demo",
            "https://recommendica.nevatal.id/comparison",
            "https://recommendica.nevatal.id/faq",
            # Disciplines
            "https://recommendica.nevatal.id/topics/ai-systems",
            "https://recommendica.nevatal.id/topics/biomedicine",
            "https://recommendica.nevatal.id/topics/climate-energy",
            "https://recommendica.nevatal.id/topics/physics-materials",
            "https://recommendica.nevatal.id/topics/neuroscience",
            "https://recommendica.nevatal.id/topics/economics-quant",
            # Curated Inquiries
            "https://recommendica.nevatal.id/search?q=scaling-laws-sparse-mixture-of-experts",
            "https://recommendica.nevatal.id/search?q=retrieval-augmented-architectures-hallucination-mitigation",
            "https://recommendica.nevatal.id/search?q=climate-change-and-public-health",
            # Courses & Lessons
            "https://recommendica.nevatal.id/courses/create-research",
            "https://recommendica.nevatal.id/courses/create-research/research-question",
            "https://recommendica.nevatal.id/courses/create-research/literature-review",
            "https://recommendica.nevatal.id/courses/create-research/research-design",
            "https://recommendica.nevatal.id/courses/create-research/project-proposal",
            "https://recommendica.nevatal.id/courses/research-step-by-step",
            "https://recommendica.nevatal.id/courses/research-step-by-step/plan-and-pilot",
            "https://recommendica.nevatal.id/courses/research-step-by-step/collect-and-organize",
            "https://recommendica.nevatal.id/courses/research-step-by-step/analyze-and-interpret",
            "https://recommendica.nevatal.id/courses/research-step-by-step/write-and-share",
            "https://recommendica.nevatal.id/courses/website-tutorial",
            "https://recommendica.nevatal.id/courses/website-tutorial/first-search",
            "https://recommendica.nevatal.id/courses/website-tutorial/understand-answers",
            "https://recommendica.nevatal.id/courses/website-tutorial/inspect-sources",
            "https://recommendica.nevatal.id/courses/website-tutorial/refine-search",
            "https://recommendica.nevatal.id/courses/read-research",
            "https://recommendica.nevatal.id/courses/read-research/map-the-paper",
            "https://recommendica.nevatal.id/courses/read-research/evaluate-methods",
            "https://recommendica.nevatal.id/courses/read-research/interpret-results",
            "https://recommendica.nevatal.id/courses/read-research/notes-and-citations",
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
        self.assertIn("https://recommendica.nevatal.id/courses", urls)
        self.assertIn("https://recommendica.nevatal.id/courses/create-research/research-question", urls)
        self.assertNotIn("https://recommendica.nevatal.id/", urls)
        self.assertNotIn("https://recommendica.nevatal.id/search", urls)

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
        self.assertIn("https://recommendica.nevatal.id/disciplines", urls)
        self.assertIn("https://recommendica.nevatal.id/topics/ai-systems", urls)
        self.assertIn("https://recommendica.nevatal.id/search?q=scaling-laws-sparse-mixture-of-experts", urls)
        self.assertNotIn("https://recommendica.nevatal.id/", urls)
        self.assertNotIn("https://recommendica.nevatal.id/courses", urls)

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
        self.assertIn("https://recommendica.nevatal.id/sitemap.xml", locs)
        self.assertIn("https://recommendica.nevatal.id/sitemap-courses.xml", locs)
        self.assertIn("https://recommendica.nevatal.id/sitemap-topics.xml", locs)
