"""Focused offline checks for the employer-career scraper's core contracts."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import urllib.parse
from unittest.mock import patch

import employer_career_ingest as scraper
import report_employer_career_ingest as report
from employer_career_ingest import _clean_description, extract_html_job, extract_postings, is_job_detail_url, load_sources, namespace_job_id, _platform


class CareerScraperTests(unittest.TestCase):
    def test_extracts_jobposting_and_namespaces_missing_identifier(self):
        html = '''<script type="application/ld+json">{
          "@context":"https://schema.org","@type":"JobPosting","title":"GIS Analyst",
          "url":"/jobs/123","description":"<p>Map fiber routes</p>",
          "hiringOrganization":{"name":"Example Corp"},
          "jobLocation":{"address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}},
          "employmentType":["FULL_TIME"]
        }</script>'''
        jobs = extract_postings(html, "https://example.com/careers", "Fallback")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "GIS Analyst")
        self.assertEqual(jobs[0]["company"], "Example Corp")
        self.assertEqual(jobs[0]["source_url"], "https://example.com/jobs/123")
        self.assertEqual(len(jobs[0]["external_job_id"]), 32)

    def test_parses_raw_json_ld_before_decoding_html_entities(self):
        posting = {
            "@type": "JobPosting",
            "title": "Cashier Team Member",
            "url": "https://jobs.example.com/job/store/cashier/123/456",
            "description": "<p>Maintain &quot;high quality&quot; service and accurate records.</p>",
        }
        html = '<script type="application/ld+json">' + json.dumps(posting) + "</script>"
        jobs = extract_postings(html, posting["url"], "Fallback")
        self.assertEqual(len(jobs), 1)
        self.assertIn('"high quality"', jobs[0]["description_text"])

    def test_extracts_jobposting_microdata_with_nested_fields(self):
        html = '''<article itemscope itemtype="https://schema.org/JobPosting">
          <h1 itemprop="title">Senior GIS Engineer</h1>
          <a itemprop="url" href="/jobs/42">View role</a>
          <meta itemprop="datePosted" content="2026-04-01">
          <div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">
            <span itemprop="name">Acme, Inc.</span>
          </div>
          <div itemprop="jobLocation" itemscope itemtype="https://schema.org/Place">
            <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
              <span itemprop="addressLocality">Seattle</span>
              <span itemprop="addressRegion">WA</span>
            </div>
          </div>
          <div itemprop="description"><p>Design mapping systems.</p><ul><li>GIS experience</li></ul></div>
          <div itemprop="identifier" itemscope itemtype="https://schema.org/PropertyValue">
            <meta itemprop="value" content="REQ-42">
          </div>
        </article>'''
        jobs = extract_postings(html, "https://example.com/careers", "Fallback")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "Senior GIS Engineer")
        self.assertEqual(jobs[0]["company"], "Acme, Inc.")
        self.assertEqual(jobs[0]["location"], "Seattle, WA")
        self.assertEqual(jobs[0]["source_url"], "https://example.com/jobs/42")
        self.assertEqual(jobs[0]["external_job_id"], "REQ-42")
        self.assertIn("GIS experience", jobs[0]["description_text"])
        self.assertEqual(jobs[0]["raw"]["posted_at"], "2026-04-01")

    def test_description_cleanup_keeps_paragraph_and_list_breaks(self):
        self.assertEqual(_clean_description("<p>First line</p><ul><li>One</li><li>Two</li></ul>"), "First line\n\n- One\n- Two")

    def test_recognizes_supported_ats_routes(self):
        self.assertEqual(_platform("https://job-boards.greenhouse.io/acme/jobs/123"), ("greenhouse", "acme"))
        self.assertEqual(_platform("https://jobs.lever.co/acme"), ("lever", "acme"))
        self.assertEqual(_platform("https://jobs.ashbyhq.com/acme"), ("ashby", "acme"))
        self.assertEqual(_platform("https://careers.smartrecruiters.com/acme"), ("smartrecruiters", "acme"))
        self.assertEqual(_platform("https://careers.smartrecruiters.com/Keenfinity/audio_career"), ("smartrecruiters", "Keenfinity|audio_career"))
        self.assertEqual(_platform("https://www.dayforcehcm.com/CandidatePortal/en-US/example"), ("dayforce", "www.dayforcehcm.com"))
        self.assertIsNone(_platform("https://dayforcehcm.com.attacker.example/careers"))
        self.assertEqual(_platform("https://jobs.smartrecruiters.com/acme/123-title"), ("smartrecruiters", "acme"))
        self.assertEqual(_platform("https://apply.workable.com/acme-systems/"), ("workable", "acme-systems"))
        self.assertEqual(_platform("https://acme.recruitee.com/o/engineer"), ("recruitee", "acme"))
        self.assertEqual(_platform("https://trilongroup.pinpointhq.com/gonzalez-companies"), ("pinpoint", "trilongroup"))
        self.assertEqual(_platform("https://aceelectric.bamboohr.com/jobs/"), ("bamboohr", "aceelectric"))
        self.assertEqual(_platform("https://careers-quanta.icims.com/jobs/search?ss=1"), ("icims", "careers-quanta"))
        self.assertEqual(_platform("https://alertalarm.breezy.hr/p/example-role"), ("breezy", "alertalarm"))
        self.assertEqual(_platform("https://minagroup.na.teamtailor.com/jobs"), ("teamtailor", "minagroup.na.teamtailor.com"))
        self.assertEqual(_platform("https://heinekamp.jobs.personio.de/job/123"), ("personio", "heinekamp"))
        self.assertEqual(_platform("https://gis.applicantstack.com/x/openings?sort=1"), ("applicantstack", "gis"))
        self.assertEqual(_platform("https://mgccontractors.applicantpro.com/jobs/"), ("applicantpro", "mgccontractors"))
        self.assertEqual(_platform("https://recruiting.paylocity.com/Recruiting/Jobs/All/0935bfc4-232a-49ad-b4f2-b3a856505c67/Company"), ("paylocity", "0935bfc4-232a-49ad-b4f2-b3a856505c67"))
        self.assertEqual(_platform("https://acme.wd5.myworkdayjobs.com/External"), ("workday", "acme|External"))
        self.assertEqual(_platform("https://hdr.taleo.net/careersection/ex/jobsearch.ftl?portal=101430233"), ("taleo", "ex"))
        self.assertEqual(_platform("https://drhorton.taleo.net/careersection/2/jobdetail.ftl?job=267161"), ("taleo", "2"))
        self.assertEqual(_platform("https://macecareers.taleo.net/careersection/careersection/ex/jobsearch.ftl"), ("taleo", "ex"))
        self.assertEqual(_platform("https://cu.taleo.net/careersection/cu_mob_sys/moresearch.ftl"), ("taleo", "MOB"))
        self.assertIsNone(_platform("https://phh.tbe.taleo.net/phh04/ats/careers/v2/searchResults?org=PCG"))

    def test_discovers_supported_ats_links_on_employer_career_pages(self):
        html = '''<a href="https://jobs.lever.co/acme">View openings</a>
                  <a href="https://jobs.lever.co/acme">Duplicate link</a>
                  <a href="http://jobs.lever.co/insecure">Do not follow</a>
                  <a href="https://unknown-ats.example/jobs">Unknown ATS</a>'''
        boards = scraper._linked_ats_boards(html, "https://acme.example/careers")
        self.assertEqual(boards, [("https://jobs.lever.co/acme", ("lever", "acme"))])

    def test_source_order_spreads_hosts_and_keeps_direct_ats_near_front(self):
        urls = [
            "https://jobs.ashbyhq.com/beta",
            "https://b.example/careers",
            "https://jobs.lever.co/charlie",
            "https://a.example/careers",
            "https://jobs.ashbyhq.com/acme",
            "https://c.example/careers",
        ]
        sources = [{"url": url, "normalized_url": url} for url in urls]
        ordered = scraper._interleave_sources_by_host(sources, workers=4)
        self.assertEqual(
            [source["url"] for source in ordered],
            [
                "https://jobs.ashbyhq.com/acme",
                "https://jobs.lever.co/charlie",
                "https://a.example/careers",
                "https://b.example/careers",
                "https://jobs.ashbyhq.com/beta",
                "https://c.example/careers",
            ],
        )
        self.assertEqual(scraper._interleave_sources_by_host(list(reversed(sources)), workers=4), ordered)

    def test_generic_career_redirect_to_ats_uses_vendor_adapter(self):
        page = SimpleNamespace(status_code=200, url="https://jobs.lever.co/acme", text="<html></html>")
        job = {"title": "Field Engineer", "company": "Acme", "source_url": "https://jobs.lever.co/acme/123", "external_job_id": "123", "raw": {}}
        with patch.object(scraper, "_request", return_value=page), patch.object(scraper, "_api_jobs", return_value=[job]) as adapter:
            jobs, method, complete, notes = scraper._crawl_generic("https://acme.example/careers", "Acme")
        adapter.assert_called_once_with("https://jobs.lever.co/acme", ("lever", "acme"), "Acme")
        self.assertEqual(jobs, [job])
        self.assertEqual(method, "redirected_ats_api:lever")
        self.assertTrue(complete)
        self.assertEqual(notes, [])

    def test_generic_career_page_uses_rippling_adapter_for_linked_board(self):
        page = SimpleNamespace(status_code=200, url="https://example.com/careers", text='<a href="https://ats.rippling.com/sample/jobs">Jobs</a>')
        job = {"title": "Engineer", "source_url": "https://ats.rippling.com/sample/jobs/id", "external_job_id": "id", "raw": {}}
        with patch.object(scraper, "_request", return_value=page), patch.object(scraper, "_rippling_jobs", return_value=([job], True, [])) as adapter:
            jobs, method, complete, notes = scraper._crawl_generic("https://example.com/careers", "Example")
        adapter.assert_called_once_with("https://ats.rippling.com/sample/jobs", "sample/jobs", "Example")
        self.assertEqual(jobs, [job])
        self.assertEqual(method, "linked_ats_api:rippling")
        self.assertTrue(complete)
        self.assertEqual(notes, [])

    def test_generic_sitemap_detail_http_failure_is_partial(self):
        landing = SimpleNamespace(status_code=200, url="https://example.com/careers", text="<html></html>")
        detail_ok = SimpleNamespace(
            status_code=200,
            url="https://example.com/jobs/1",
            text='<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"https://example.com/jobs/1","description":"Build systems"}</script>',
        )
        detail_missing = SimpleNamespace(status_code=404, url="https://example.com/jobs/2", text="")
        urls = [detail_ok.url, detail_missing.url]
        with patch.object(scraper, "_request", side_effect=[landing, detail_ok, detail_missing]), \
             patch.object(scraper, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, method, complete, notes = scraper._crawl_generic(landing.url, "Example")
        self.assertEqual(method, "sitemap_structured_data")
        self.assertEqual([job["source_url"] for job in jobs], [detail_ok.url])
        self.assertFalse(complete)
        self.assertIn("detail page returned HTTP 404: https://example.com/jobs/2", notes)

    def test_generic_sitemap_detail_without_job_is_partial(self):
        landing = SimpleNamespace(status_code=200, url="https://example.com/careers", text="<html></html>")
        detail_ok = SimpleNamespace(
            status_code=200,
            url="https://example.com/jobs/1",
            text='<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"https://example.com/jobs/1","description":"Build systems"}</script>',
        )
        detail_empty = SimpleNamespace(status_code=200, url="https://example.com/jobs/2", text="<html><h1>Careers</h1></html>")
        urls = [detail_ok.url, detail_empty.url]
        with patch.object(scraper, "_request", side_effect=[landing, detail_ok, detail_empty]), \
             patch.object(scraper, "_discover_sitemaps", return_value=(urls, True, [])):
            jobs, method, complete, notes = scraper._crawl_generic(landing.url, "Example")
        self.assertEqual(method, "sitemap_structured_data")
        self.assertEqual([job["source_url"] for job in jobs], [detail_ok.url])
        self.assertFalse(complete)
        self.assertIn("detail page had no extractable job posting: https://example.com/jobs/2", notes)

    def test_generic_mixed_sitemap_does_not_infer_job_only_from_careers_hostname(self):
        xml = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://careers.example.com/jobs/1</loc></url>
          <url><loc>https://careers.example.com/about</loc></url>
        </urlset>'''
        job_url = "https://careers.example.com/jobs/1"

        for fallback in (False, True):
            def fake_request(url, **_kwargs):
                status = 404 if fallback and url.endswith("/sitemap.xml") else 200
                return SimpleNamespace(status_code=status, content=xml)

            with self.subTest(fallback=fallback), \
                 patch.object(scraper, "_robots_parser", return_value=None), \
                 patch.object(scraper, "_request", side_effect=fake_request):
                urls, complete, _notes = scraper._discover_sitemaps("https://careers.example.com/")
            self.assertEqual(urls, [job_url])
            self.assertFalse(complete)

    def test_vendor_local_job_ids_are_scoped_to_career_board(self):
        job = {"external_job_id": "123", "source_url": "https://jobs.example.com/job/123", "raw": {"career_source_url": "https://example.com/careers"}}
        namespaced = namespace_job_id(job)
        self.assertTrue(namespaced["external_job_id"].startswith("career:"))
        self.assertIn(":123", namespaced["external_job_id"])
        self.assertEqual(namespace_job_id(namespaced)["external_job_id"], namespaced["external_job_id"])
        query_variant = {"external_job_id": "123", "source_url": "https://jobs.example.com/job/123", "raw": {"career_source_url": "https://example.com/careers?jobId=123"}}
        self.assertEqual(namespace_job_id(query_variant)["external_job_id"], namespaced["external_job_id"])

    def test_job_payload_dedupe_is_scoped_to_adapter_version(self):
        base = {"external_job_id": "42", "source_url": "https://example.com/jobs/42", "raw": {"adapter_version": "v10"}}
        older = {**base, "raw": {"adapter_version": "v9"}}
        self.assertEqual(scraper._job_dedupe_key(base), scraper._job_dedupe_key({**base}))
        self.assertNotEqual(scraper._job_dedupe_key(base), scraper._job_dedupe_key(older))

    def test_paylocity_adapter_maps_v2_public_feed(self):
        payload = {"displayName": "Example Inc", "jobs": [{"jobId": 42, "title": "Field Engineer", "applyUrl": "https://jobs.example/apply/42", "description": "<p>Build networks</p>", "jobLocation": {"name": "Austin"}, "publishedDate": "2026-11-01"}]}
        response = SimpleNamespace(json=lambda: payload)
        with patch.object(scraper, "_request", return_value=response) as request:
            rows = scraper._api_jobs("https://recruiting.paylocity.com/Recruiting/Jobs/All/board-guid/Company", ("paylocity", "board-guid"), "Example Inc")
        request.assert_called_once_with("https://recruiting.paylocity.com/recruiting/v2/api/feed/jobs/board-guid")
        self.assertEqual(rows[0]["title"], "Field Engineer")
        self.assertEqual(rows[0]["location"], "Austin")
        self.assertIn("Build networks", rows[0]["description_text"])

    def test_pinpoint_public_postings_feed_maps_full_job_payload(self):
        payload = {"data": [{
            "id": "posting-1", "title": "GIS Analyst",
            "url": "https://trilongroup.pinpointhq.com/en/postings/posting-1#details",
            "description": "<p>Map fiber routes</p>", "key_responsibilities": "<ul><li>Own maps</li></ul>",
            "employment_type_text": "Full Time", "workplace_type_text": "Hybrid",
            "department": {"id": "1", "name": "Engineering"},
            "location": {"id": "2", "name": "Austin, TX"},
            "requisition_id": "REQ-12", "compensation": "$100,000",
        }]}
        with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=200, json=lambda: payload)) as request:
            jobs, complete, notes = scraper._pinpoint_jobs("https://trilongroup.pinpointhq.com/", "trilongroup", "Trilon Group")
        request.assert_called_once_with("https://trilongroup.pinpointhq.com/postings.json")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "GIS Analyst")
        self.assertEqual(jobs[0]["company"], "Trilon Group")
        self.assertEqual(jobs[0]["location"], "Austin, TX")
        self.assertEqual(jobs[0]["source_url"], "https://trilongroup.pinpointhq.com/en/postings/posting-1")
        self.assertIn("Map fiber routes", jobs[0]["description_text"])
        self.assertIn("Own maps", jobs[0]["description_text"])
        self.assertEqual(jobs[0]["raw"]["department"], "Engineering")

    def test_pinpoint_incomplete_feed_row_cannot_be_marked_complete(self):
        payload = {"data": [{"id": "1", "title": "Role", "url": "http://example.com/job/1"}]}
        with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=200, json=lambda: payload)):
            jobs, complete, notes = scraper._pinpoint_jobs("https://example.pinpointhq.com", "example", "Example")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(notes)

    def test_bamboohr_public_career_feed_fetches_details_and_validates_total(self):
        list_payload = {"meta": {"totalCount": 1}, "result": [{"id": "601", "jobOpeningName": "Electrical Superintendent", "departmentLabel": "STB", "location": {"city": "Augusta", "state": "Georgia"}}]}
        detail_payload = {"meta": {}, "result": {"jobOpening": {
            "jobOpeningShareUrl": "https://aceelectric.bamboohr.com/careers/601",
            "jobOpeningName": "Electrical Superintendent", "jobOpeningStatus": "Open",
            "description": "<p>Lead project execution.</p>", "datePosted": "2026-11-01",
            "departmentLabel": "STB", "employmentStatusLabel": "A - Full Time",
            "location": {"city": "Augusta", "state": "Georgia", "addressCountry": "US"},
        }}}
        responses = [
            SimpleNamespace(status_code=200, json=lambda: list_payload),
            SimpleNamespace(status_code=200, json=lambda: detail_payload),
        ]
        with patch.object(scraper, "_request", side_effect=responses) as request:
            jobs, complete, notes = scraper._bamboohr_jobs("https://aceelectric.bamboohr.com/jobs/", "aceelectric", "Ace Electric")
        self.assertEqual(request.call_args_list[0].args[0], "https://aceelectric.bamboohr.com/careers/list")
        self.assertEqual(request.call_args_list[1].args[0], "https://aceelectric.bamboohr.com/careers/601/detail")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["external_job_id"], "601")
        self.assertEqual(jobs[0]["company"], "Ace Electric")
        self.assertIn("Lead project execution", jobs[0]["description_text"])
        self.assertEqual(jobs[0]["location"], "Augusta, Georgia, US")

    def test_bamboohr_list_count_mismatch_is_partial(self):
        list_payload = {"meta": {"totalCount": 2}, "result": [{"id": "1", "jobOpeningName": "Role"}]}
        detail_payload = {"result": {"jobOpening": {"jobOpeningName": "Role", "jobOpeningShareUrl": "https://example.bamboohr.com/careers/1"}}}
        responses = [SimpleNamespace(status_code=200, json=lambda: list_payload), SimpleNamespace(status_code=200, json=lambda: detail_payload)]
        with patch.object(scraper, "_request", side_effect=responses):
            jobs, complete, notes = scraper._bamboohr_jobs("https://example.bamboohr.com/careers", "example", "Example")
        self.assertFalse(complete)
        self.assertEqual(len(jobs), 1)
        self.assertTrue(any("returned 1 of 2" in note for note in notes))

    def test_icims_pagination_fetches_all_job_detail_pages(self):
        search0 = '<div>Page 1 of 2</div><a href="/jobs/100/gis-analyst/job?in_iframe=1">GIS Analyst</a>'
        search1 = '<div>Page 2 of 2</div><a href="/jobs/101/field-engineer/job?in_iframe=1">Field Engineer</a>'
        detail = lambda title, ident: f'''<script type="application/ld+json">{{"@type":"JobPosting","title":"{title}","url":"https://careers-quanta.icims.com/jobs/{ident}/role/job","identifier":{{"value":"{ident}"}},"description":"<p>Build infrastructure</p>","hiringOrganization":{{"name":"Quanta Services"}}}}</script>'''
        responses = [
            SimpleNamespace(status_code=200, text=search0),
            SimpleNamespace(status_code=200, text=search1),
            SimpleNamespace(status_code=200, url="https://careers-quanta.icims.com/jobs/100/gis-analyst/job?in_iframe=1", text=detail("GIS Analyst", "100")),
            SimpleNamespace(status_code=200, url="https://careers-quanta.icims.com/jobs/101/field-engineer/job?in_iframe=1", text=detail("Field Engineer", "101")),
        ]
        with patch.object(scraper, "_request", side_effect=responses) as request:
            jobs, complete, notes = scraper._icims_jobs("https://careers-quanta.icims.com/jobs/search", "careers-quanta", "Quanta Services")
        self.assertTrue(complete, notes)
        self.assertEqual([job["title"] for job in jobs], ["GIS Analyst", "Field Engineer"])
        self.assertEqual([job["external_job_id"] for job in jobs], ["100", "101"])
        self.assertEqual(request.call_count, 4)
        self.assertIn("pr=1", request.call_args_list[1].args[0])

    def test_icims_parser_reads_page_indicator_and_job_cards(self):
        page, total, links = scraper._parse_icims_page('<p>Page 3 of 27</p><a href="/jobs/123/example/job">Example Role</a>')
        self.assertEqual((page, total), (3, 27))
        self.assertEqual(links, [("/jobs/123/example/job", "Example Role")])

    def test_icims_explicit_empty_board_is_complete_zero_jobs(self):
        html = '<div class="iCIMS_Message iCIMS_ErrorMessage">Sorry, no jobs were found that match your search criteria. Please try other selections.</div>'
        self.assertTrue(scraper._icims_page_explicitly_empty(html))
        with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=200, text=html)):
            jobs, complete, notes = scraper._icims_jobs("https://careers-kfs.icims.com/jobs/search", "careers-kfs", "KFS")
        self.assertEqual(jobs, [])
        self.assertTrue(complete)
        self.assertEqual(notes, [])

    def test_breezy_public_feed_maps_jobs_and_fetches_detail_description(self):
        payload = [{
            "id": "posting-1", "name": "Fire Alarm Technician",
            "url": "https://alertalarm.breezy.hr/p/posting-1-fire-alarm-technician",
            "published_date": "2026-11-01", "department": "Field Operations",
            "type": {"id": "full_time", "name": "Full-Time"}, "salary": "$30/hour",
            "company": {"name": "Zeus Fire and Security"},
            "location": {"name": "Honolulu, HI", "city": "Honolulu", "state": {"name": "Hawaii"}, "country": {"name": "United States"}, "remote_details": {"label": "On-site"}},
        }]
        html = '''<script type="application/ld+json">{"@type":"JobPosting","title":"Fire Alarm Technician","url":"https://alertalarm.breezy.hr/p/posting-1-fire-alarm-technician","description":"<p>Install and service alarms.</p>"}</script>'''
        responses = [SimpleNamespace(status_code=200, json=lambda: payload), SimpleNamespace(status_code=200, url=payload[0]["url"], text=html)]
        with patch.object(scraper, "_request", side_effect=responses) as request:
            jobs, complete, notes = scraper._breezy_jobs("https://alertalarm.breezy.hr/", "alertalarm", "Alert Alarm")
        self.assertEqual(request.call_args_list[0].args[0], "https://alertalarm.breezy.hr/json")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["company"], "Zeus Fire and Security")
        self.assertEqual(jobs[0]["location"], "Honolulu, HI")
        self.assertIn("Install and service alarms", jobs[0]["description_text"])
        self.assertEqual(jobs[0]["raw"]["employment_type"], "Full-Time")

    def test_personio_xml_feed_maps_positions_and_descriptions(self):
        xml = b'''<workzag-jobs><position><id>12345</id><subcompany>Engineering Group</subcompany><office>Munich</office><department>Engineering</department><recruitingCategory>Software</recruitingCategory><name>Senior Platform Engineer</name><jobDescriptions><jobDescription><name>About the role</name><value><![CDATA[<p>Build the platform.</p>]]></value></jobDescription><jobDescription><name>Requirements</name><value><![CDATA[<ul><li>Python</li></ul>]]></value></jobDescription></jobDescriptions><employmentType>permanent</employmentType><schedule>full-time</schedule><seniority>experienced</seniority><createdAt>2026-11-02</createdAt></position></workzag-jobs>'''
        with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=200, content=xml)) as request:
            jobs, complete, notes = scraper._personio_jobs("https://heinekamp.jobs.personio.de/", "heinekamp", "Heinekamp")
        request.assert_called_once_with("https://heinekamp.jobs.personio.de/xml?language=en")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["external_job_id"], "12345")
        self.assertEqual(jobs[0]["company"], "Engineering Group")
        self.assertIn("Build the platform", jobs[0]["description_text"])
        self.assertIn("Python", jobs[0]["description_text"])

    def test_teamtailor_rss_feed_paginates_and_maps_job_metadata(self):
        page0 = b'''<rss xmlns:tt="https://teamtailor.com/locations"><channel><item><title>Field Engineer</title><description>&lt;p&gt;Build networks&lt;/p&gt;</description><pubDate>Thu, 05 Nov 2026 11:24:41 -0800</pubDate><link>https://minagroup.na.teamtailor.com/jobs/1-field-engineer</link><remoteStatus>none</remoteStatus><guid>job-guid-1</guid><locations>Austin, TX</locations><department>Engineering</department><role>Engineer</role><division>Field Services</division></item></channel></rss>'''
        page1 = b'''<rss><channel /></rss>'''
        responses = [SimpleNamespace(status_code=200, content=page0), SimpleNamespace(status_code=200, content=page1)]
        with patch.object(scraper, "TEAMTAILOR_PAGE_SIZE", 1), patch.object(scraper, "_request", side_effect=responses) as request:
            jobs, complete, notes = scraper._teamtailor_jobs("https://minagroup.na.teamtailor.com/jobs", "minagroup.na.teamtailor.com", "MINA Group")
        self.assertTrue(complete, notes)
        self.assertEqual(request.call_count, 2)
        self.assertIn("offset=1", request.call_args_list[1].args[0])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["external_job_id"], "job-guid-1")
        self.assertEqual(jobs[0]["location"], "Austin, TX")
        self.assertIn("Build networks", jobs[0]["description_text"])

    def test_scrape_source_dispatches_pinpoint_to_public_json_feed(self):
        source = {
            "url": "https://trilongroup.pinpointhq.com/", "normalized_url": "https://trilongroup.pinpointhq.com/",
            "source_urls": ["https://trilongroup.pinpointhq.com/"], "evidence_urls": [],
            "employers": ["Trilon Group"], "employer_keys": ["company_id:2"],
        }
        job = {"title": "Engineer", "company": "Trilon Group", "source_url": "https://trilongroup.pinpointhq.com/postings/1", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_pinpoint_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "trilongroup", "Trilon Group")
        self.assertEqual(result["method"], "public_json_feed:pinpoint-v1")
        self.assertTrue(result["complete"])

    def test_scrape_source_dispatches_bamboohr_to_public_career_adapter(self):
        source = {
            "url": "https://aceelectric.bamboohr.com/jobs/", "normalized_url": "https://aceelectric.bamboohr.com/jobs",
            "source_urls": ["https://aceelectric.bamboohr.com/jobs/"], "evidence_urls": [],
            "employers": ["Ace Electric"], "employer_keys": ["company_id:3"],
        }
        job = {"title": "Engineer", "company": "Ace Electric", "source_url": "https://aceelectric.bamboohr.com/careers/1", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_bamboohr_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "aceelectric", "Ace Electric")
        self.assertEqual(result["method"], "public_career_json:bamboohr-v1")
        self.assertTrue(result["complete"])

    def test_scrape_source_dispatches_icims_to_public_html_adapter(self):
        source = {
            "url": "https://careers-quanta.icims.com/jobs/search", "normalized_url": "https://careers-quanta.icims.com/jobs/search",
            "source_urls": ["https://careers-quanta.icims.com/jobs/search"], "evidence_urls": [],
            "employers": ["Quanta Services"], "employer_keys": ["company_id:4"],
        }
        job = {"title": "Engineer", "company": "Quanta Services", "source_url": "https://careers-quanta.icims.com/jobs/1/engineer/job", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_icims_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "careers-quanta", "Quanta Services")
        self.assertEqual(result["method"], "public_html_pagination:icims-v1")
        self.assertTrue(result["complete"])

    def test_scrape_source_dispatches_breezy_to_public_feed_adapter(self):
        source = {
            "url": "https://alertalarm.breezy.hr/", "normalized_url": "https://alertalarm.breezy.hr/",
            "source_urls": ["https://alertalarm.breezy.hr/"], "evidence_urls": [],
            "employers": ["Alert Alarm"], "employer_keys": ["company_id:5"],
        }
        job = {"title": "Technician", "company": "Alert Alarm", "source_url": "https://alertalarm.breezy.hr/p/1", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_breezy_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "alertalarm", "Alert Alarm")
        self.assertEqual(result["method"], "public_json_feed:breezy-v1")
        self.assertTrue(result["complete"])

    def test_scrape_source_dispatches_teamtailor_to_public_rss_adapter(self):
        source = {
            "url": "https://minagroup.na.teamtailor.com/jobs", "normalized_url": "https://minagroup.na.teamtailor.com/jobs",
            "source_urls": ["https://minagroup.na.teamtailor.com/jobs"], "evidence_urls": [],
            "employers": ["MINA Group"], "employer_keys": ["company_id:6"],
        }
        job = {"title": "Engineer", "company": "MINA Group", "source_url": "https://minagroup.na.teamtailor.com/jobs/1", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_teamtailor_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "minagroup.na.teamtailor.com", "MINA Group")
        self.assertEqual(result["method"], "public_rss_pagination:teamtailor-v1")
        self.assertTrue(result["complete"])

    def test_neogov_governmentjobs_and_schooljobs_are_policy_held_without_requests(self):
        for url in (
            "https://www.governmentjobs.com/careers/example",
            "https://careers.governmentjobs.com/careers/example",
            "https://www.schooljobs.com/careers/example",
        ):
            source = {
                "url": url,
                "normalized_url": url,
                "source_urls": [url],
                "evidence_urls": [],
                "employers": ["Example"],
                "employer_keys": ["company_id:9"],
            }
            with patch.object(scraper, "_request", side_effect=AssertionError("held source must not be requested")) as request:
                result = scraper.scrape_source(source)
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["method"], "policy_hold")
            self.assertFalse(result["complete"])
            self.assertEqual(result["jobs"], [])
            self.assertIn("NEOGOV", result["error"])
            request.assert_not_called()

    def test_usajobs_requires_registered_api_configuration_before_any_request(self):
        url = "https://www.usajobs.gov/Search/Results?a=agency"
        source = {
            "url": url,
            "normalized_url": url,
            "source_urls": [url],
            "evidence_urls": [],
            "employers": ["Example Agency"],
            "employer_keys": ["company_id:10"],
        }
        with patch.dict("os.environ", {
            "USAJOBS_API_KEY": "",
            "USAJOBS_API_EMAIL": "",
            "TALENTOS_USAJOBS_ORGANIZATION_MAP_JSON": "",
        }), patch.object(scraper, "_request", side_effect=AssertionError("missing API config must not request")) as request:
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertIn("registered API key", result["error"])
        request.assert_not_called()

    def test_usajobs_search_api_paginates_with_exact_org_mapping_and_auth_headers(self):
        url = "https://www.usajobs.gov/Search/Results?a=agency"
        self.assertEqual(scraper._platform(url), ("usajobs", "www.usajobs.gov"))
        long_summary = "Manage and maintain federal engineering systems, coordinate technical reviews, document work, and support a national operations team. " * 2

        def response(posting_id: str, title: str) -> SimpleNamespace:
            item = {
                "MatchedObjectId": posting_id,
                "MatchedObjectDescriptor": {
                    "PositionID": posting_id,
                    "PositionTitle": title,
                    "PositionURI": f"https://www.usajobs.gov/job/{posting_id}/",
                    "OrganizationName": "Example Federal Agency",
                    "DepartmentName": "Example Department",
                    "PositionLocation": [{"LocationName": "Washington, DC"}],
                    "PositionFormattedDescription": [],
                    "UserArea": {"Details": {"JobSummary": long_summary}},
                },
            }
            payload = {
                "SearchResult": {
                    "SearchResultCount": 1,
                    "SearchResultCountAll": 2,
                    "SearchResultItems": [item],
                },
                "UserArea": {"NumberOfPages": 2},
            }
            return SimpleNamespace(status_code=200, json=lambda: payload)

        source = {
            "url": url,
            "normalized_url": url,
            "source_urls": [url],
            "evidence_urls": [],
            "employers": ["Example Agency"],
            "employer_keys": ["company_id:10"],
        }
        with patch.dict("os.environ", {
            "USAJOBS_API_KEY": "test-api-key",
            "USAJOBS_API_EMAIL": "jobs@example.test",
            "TALENTOS_USAJOBS_ORGANIZATION_MAP_JSON": json.dumps({"www.usajobs.gov": "EXAMPLE"}),
        }), patch.object(scraper, "_request", side_effect=[response("R1", "Engineer"), response("R2", "Architect")]) as request:
            result = scraper.scrape_source(source)

        self.assertEqual(result["status"], "scraped")
        self.assertEqual(result["method"], "official_search_api:usajobs-v1")
        self.assertTrue(result["complete"])
        self.assertEqual(result["job_count"], 2)
        self.assertEqual({job["external_job_id"] for job in result["jobs"]}, {"R1", "R2"})
        self.assertEqual(result["jobs"][0]["company"], "Example Federal Agency")
        self.assertEqual(result["jobs"][0]["location"], "Washington, DC")
        self.assertEqual(result["jobs"][0]["raw"]["source_provider"], "USAJOBS")
        self.assertEqual(request.call_count, 2)
        for call, expected_page in zip(request.call_args_list, ("1", "2")):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(call.args[0]).query)
            self.assertEqual(query["Organization"], ["EXAMPLE"])
            self.assertEqual(query["Fields"], ["Full"])
            self.assertEqual(query["Page"], [expected_page])
            self.assertEqual(query["ResultsPerPage"], ["500"])
            self.assertEqual(call.kwargs["headers"]["Authorization-Key"], "test-api-key")
            self.assertEqual(call.kwargs["headers"]["User-Agent"], "jobs@example.test")
            self.assertEqual(call.kwargs["allowed_hosts"], {"data.usajobs.gov"})

    def test_request_passes_custom_api_headers_and_basic_auth(self):
        seen_user_agents = []

        class Rules:
            def can_fetch(self, user_agent: str, url: str) -> bool:
                seen_user_agents.append(user_agent)
                return user_agent == "jobs@example.test"

            def crawl_delay(self, user_agent: str) -> int:
                return 0

        class RawBody:
            def read(self, size: int, *, decode_content: bool = True) -> bytes:
                return b"{}"

        response = SimpleNamespace(
            status_code=200,
            headers={},
            raw=RawBody(),
            is_redirect=False,
            is_permanent_redirect=False,
            close=lambda: None,
        )

        class Session:
            request_headers: dict[str, str] = {}
            request_auth: tuple[str, str] | None = None

            def get(self, url: str, **kwargs: object) -> SimpleNamespace:
                self.request_headers = kwargs["headers"]  # type: ignore[assignment]
                self.request_auth = kwargs.get("auth")  # type: ignore[assignment]
                return response

        session = Session()
        url = "https://data.usajobs.gov/api/Search"
        with patch.object(scraper, "_robots_parser", return_value=Rules()), \
             patch.object(scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(scraper.time, "sleep"), patch.object(scraper, "_shared_host_rate_dir", None), \
             patch.dict(scraper._last_host_request, {}, clear=True), \
             patch.object(scraper, "_content_request_count", 0):
            fetched = scraper._request(
                url, headers={"User-Agent": "jobs@example.test"}, auth=("tenant-user", "tenant-secret"), session=session
            )
            self.assertEqual(scraper._content_request_count, 1)
        self.assertEqual(seen_user_agents, ["jobs@example.test"])
        self.assertEqual(session.request_headers["User-Agent"], "jobs@example.test")
        self.assertEqual(session.request_auth, ("tenant-user", "tenant-secret"))
        self.assertEqual(fetched._content, b"{}")

    def test_read_only_workday_search_post_counts_as_a_content_request(self):
        class Rules:
            def can_fetch(self, user_agent: str, url: str) -> bool:
                return True

            def crawl_delay(self, user_agent: str) -> int:
                return 0

        response = SimpleNamespace(
            status_code=200, headers={}, content=b"{}", raise_for_status=lambda: None, close=lambda: None,
        )
        url = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs"
        with patch.object(scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(scraper, "_robots_parser", return_value=Rules()), \
             patch.object(scraper, "_shared_host_rate_dir", None), \
             patch.object(scraper, "_content_request_count", 0), \
             patch.dict(scraper._last_host_request, {}, clear=True), \
             patch.object(scraper.time, "sleep"), \
             patch.object(scraper.requests, "post", return_value=response) as post:
            fetched = scraper._request_post(url, "{}")
            self.assertEqual(scraper._content_request_count, 1)
        post.assert_called_once()
        self.assertIs(fetched, response)

    def test_request_rejects_off_host_redirect_before_resending_api_credentials(self):
        seen_user_agents = []

        class Rules:
            def can_fetch(self, user_agent: str, url: str) -> bool:
                seen_user_agents.append(user_agent)
                return True

            def crawl_delay(self, user_agent: str) -> int:
                return 0

        response = SimpleNamespace(
            status_code=302,
            headers={"Location": "https://outside.example/collect"},
            is_redirect=True,
            is_permanent_redirect=False,
            close=lambda: None,
        )

        class Session:
            requests: list[tuple[str, dict[str, str], object]] = []

            def get(self, url: str, **kwargs: object) -> SimpleNamespace:
                self.requests.append((url, kwargs["headers"], kwargs.get("auth")))  # type: ignore[arg-type]
                return response

        session = Session()
        with patch.object(scraper, "_robots_parser", return_value=Rules()), \
             patch.object(scraper, "_public_https_url", side_effect=lambda value: urllib.parse.urlparse(value)), \
             patch.object(scraper.time, "sleep"), patch.object(scraper, "_shared_host_rate_dir", None), \
             patch.dict(scraper._last_host_request, {}, clear=True):
            with self.assertRaisesRegex(scraper.ScrapeFailure, "redirect target is outside"):
                scraper._request(
                    "https://www.dayforcehcm.com/api/Example/V1/JobFeeds",
                    headers={"User-Agent": "jobs@example.test", "Authorization-Key": "secret-test-key"},
                    auth=("tenant-user", "tenant-secret"),
                    allowed_hosts={"www.dayforcehcm.com"},
                    session=session,
                )
        self.assertEqual(len(session.requests), 1)
        self.assertEqual(session.requests[0][0], "https://www.dayforcehcm.com/api/Example/V1/JobFeeds")
        self.assertEqual(session.requests[0][1]["Authorization-Key"], "secret-test-key")
        self.assertEqual(session.requests[0][2], ("tenant-user", "tenant-secret"))
        self.assertEqual(seen_user_agents, ["jobs@example.test"])

    def test_dayforce_requires_authorized_tenant_configuration_before_any_request(self):
        url = "https://www.dayforcehcm.com/CandidatePortal/en-US/example"
        source = {
            "url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [],
            "employers": ["Example"], "employer_keys": ["company_id:12"],
        }
        with patch.dict("os.environ", {"TALENTOS_DAYFORCE_JOBFEED_CONFIG_JSON": ""}), \
             patch.object(scraper, "_request", side_effect=AssertionError("missing tenant config must not request")) as request:
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertIn("tenant credentials", result["error"])
        request.assert_not_called()

    def test_dayforce_jobfeeds_uses_configured_basic_auth_and_maps_public_postings(self):
        url = "https://prdemo.dayforcehcm.com/CandidatePortal/en-US/example"
        long_description = "Support the engineering team by planning, documenting, and delivering reliable customer services. " * 2
        payload = [{
            "Title": "Field Engineer",
            "Description": long_description,
            "CompanyName": "Example Co.",
            "JobDetailsUrl": "https://prdemo.dayforcehcm.com/CandidatePortal/en-US/example/Posting/View/17",
            "ApplyUrl": "https://prdemo.dayforcehcm.com/CandidatePortal/en-US/example/JobPosting/Apply?jobId=17",
            "City": "Austin",
            "State": "TX",
            "Country": "USA",
            "DatePosted": "2026-11-13T00:00:00",
            "LastUpdated": "2026-11-13T08:30:00",
            "ReferenceNumber": 17,
            "EmploymentIndicator": "Full-time",
            "JobFunction": "Engineering",
        }, {
            "Title": "Data Analyst",
            "Description": long_description,
            "JobDetailsUrl": "http://localhost:51009/en-US/Posting/View/18",
            "ApplyUrl": "https://prdemo.dayforcehcm.com/CandidatePortal/en-US/example/JobPosting/Apply?jobId=18",
            "ReferenceNumber": 18,
        }]
        response = SimpleNamespace(status_code=200, json=lambda: payload)
        source = {
            "url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [],
            "employers": ["Example"], "employer_keys": ["company_id:12"],
        }
        config = {scraper.normalize_source_url(url): {
            "company_name": "Example Co", "username": "tenant-user", "password": "tenant-secret",
            "internal_job_board_code": "CANDIDATEPORTAL",
        }}
        with patch.dict("os.environ", {"TALENTOS_DAYFORCE_JOBFEED_CONFIG_JSON": json.dumps(config)}), \
             patch.object(scraper, "_request", return_value=response) as request:
            result = scraper.scrape_source(source)

        self.assertEqual(result["status"], "scraped")
        self.assertTrue(result["complete"])
        self.assertEqual(result["method"], "authorized_customer_api:dayforce-jobfeeds-v1")
        self.assertEqual(result["job_count"], 2)
        job = result["jobs"][0]
        self.assertEqual(job["external_job_id"], "17")
        self.assertEqual(job["company"], "Example Co.")
        self.assertEqual(job["location"], "Austin, TX, USA")
        self.assertEqual(job["source_url"], payload[0]["JobDetailsUrl"])
        self.assertEqual(job["raw"]["job_details_url"], payload[0]["JobDetailsUrl"])
        self.assertEqual(result["jobs"][1]["source_url"], payload[1]["ApplyUrl"])
        self.assertNotIn("tenant-secret", json.dumps(result))
        request.assert_called_once()
        call = request.call_args
        parsed_api = urllib.parse.urlsplit(call.args[0])
        self.assertEqual(parsed_api.scheme, "https")
        self.assertEqual(parsed_api.netloc, "www.dayforcehcm.com")
        self.assertEqual(parsed_api.path, "/api/Example%20Co/V1/JobFeeds")
        self.assertEqual(urllib.parse.parse_qs(parsed_api.query), {
            "includeActivePostingOnly": ["true"], "internalJobBoardCode": ["CANDIDATEPORTAL"],
        })
        self.assertEqual(call.kwargs["headers"]["Accept"], "application/json")
        self.assertEqual(call.kwargs["auth"], ("tenant-user", "tenant-secret"))
        self.assertEqual(call.kwargs["allowed_hosts"], {"www.dayforcehcm.com"})

    def test_dayforce_invalid_and_duplicate_rows_make_the_feed_partial(self):
        url = "https://www.dayforcehcm.com/CandidatePortal/en-US/example"
        long_description = "Build and maintain internal systems, coordinate releases, and document engineering work. " * 2
        valid = {
            "Title": "Engineer", "Description": long_description, "ReferenceNumber": "R-1",
            "ApplyUrl": "https://www.dayforcehcm.com/CandidatePortal/en-US/example/job/1",
        }
        payload = [
            valid,
            dict(valid),
            {"Title": "Bad URL", "Description": long_description, "ReferenceNumber": "R-2", "ApplyUrl": "https://attacker.example/jobs/2"},
            {"Title": "Short", "Description": "Short", "ReferenceNumber": "R-3", "JobDetailsUrl": "https://www.dayforcehcm.com/jobs/3"},
        ]
        response = SimpleNamespace(status_code=200, json=lambda: payload)
        source = {
            "url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [],
            "employers": ["Example"], "employer_keys": ["company_id:12"],
        }
        config = {"www.dayforcehcm.com": {
            "company_name": "Example", "username": "tenant-user", "password": "tenant-secret",
        }}
        with patch.dict("os.environ", {"TALENTOS_DAYFORCE_JOBFEED_CONFIG_JSON": json.dumps(config)}), \
             patch.object(scraper, "_request", return_value=response):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["complete"])
        self.assertEqual(result["job_count"], 2)
        self.assertEqual({job["external_job_id"] for job in result["jobs"]}, {"R-1", "R-3"})
        self.assertTrue(any("duplicate reference" in note for note in result["notes"]))
        self.assertTrue(any("valid title" in note for note in result["notes"]))
        self.assertTrue(any("short or empty description" in note for note in result["notes"]))

    def test_dayforce_non_list_response_fails_closed(self):
        url = "https://www.dayforcehcm.com/CandidatePortal/en-US/example"
        source = {
            "url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [],
            "employers": ["Example"], "employer_keys": ["company_id:12"],
        }
        config = {"www.dayforcehcm.com": {
            "company_name": "Example", "username": "tenant-user", "password": "tenant-secret",
        }}
        with patch.dict("os.environ", {"TALENTOS_DAYFORCE_JOBFEED_CONFIG_JSON": json.dumps(config)}), \
             patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=200, json=lambda: {"jobs": []})):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "error")
        self.assertIn("not a posting list", result["error"])

    def test_personio_feed_unavailable_falls_back_to_public_career_page(self):
        source = {
            "url": "https://sample.jobs.personio.de/", "normalized_url": "https://sample.jobs.personio.de/",
            "source_urls": ["https://sample.jobs.personio.de/"], "evidence_urls": [],
            "employers": ["Sample"], "employer_keys": ["company_id:7"],
        }
        job = {"title": "Engineer", "company": "Sample", "source_url": "https://sample.jobs.personio.de/job/1", "external_job_id": "1", "raw": {}}
        with patch.object(scraper, "_personio_jobs", side_effect=scraper.ScrapeFailure("HTTP 404")), patch.object(scraper, "_crawl_generic", return_value=([job], "sitemap_structured_data", True, [])) as fallback:
            result = scraper.scrape_source(source)
        fallback.assert_called_once_with(source["url"], "Sample")
        self.assertEqual(result["method"], "personio_page_fallback:sitemap_structured_data")
        self.assertTrue(result["complete"])
        self.assertIn("HTTP 404", result["notes"][0])

    def test_personio_html_fallback_and_official_redirect_dispatch(self):
        board_url = "https://sample.jobs.personio.de/"
        job_url = "https://sample.jobs.personio.de/job/123"
        html = '<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","url":"https://sample.jobs.personio.de/job/123","description":"Build systems"}</script>'
        response = SimpleNamespace(status_code=200, text=html, url=board_url)
        source = {"url": board_url, "normalized_url": board_url, "source_urls": [board_url], "evidence_urls": [], "employers": ["Sample"], "employer_keys": ["sample"]}
        with patch.object(scraper, "_personio_jobs", side_effect=scraper.ScrapeFailure("HTTP 404")) as feed, \
             patch.object(scraper, "_request", return_value=response), \
             patch.object(scraper, "_discover_sitemaps", return_value=([], False, [])):
            result = scraper.scrape_source(source)
        self.assertEqual(feed.call_count, 1)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["method"], "personio_page_fallback:linked_pages_structured_data")
        self.assertEqual([job["source_url"] for job in result["jobs"]], [job_url])

        official_url = "https://official.example/careers"
        official = {**source, "url": official_url, "normalized_url": official_url, "source_urls": [official_url]}
        api_job = {"title": "Engineer", "company": "Sample", "source_url": job_url, "external_job_id": "123", "raw": {}}
        with patch.object(scraper, "_personio_jobs", return_value=([api_job], True, [])) as feed, \
             patch.object(scraper, "_request", return_value=response):
            redirected = scraper.scrape_source(official)
        feed.assert_called_once_with(board_url, "sample", "Sample")
        self.assertTrue(redirected["complete"])
        self.assertEqual(redirected["method"], "redirected_public_xml_feed:personio-v1")

    def test_greenhouse_total_count_must_match_before_complete_scrape(self):
        payload = {"meta": {"total": 1}, "jobs": [{"id": 123, "title": "GIS Analyst", "absolute_url": "https://boards.greenhouse.io/acme/jobs/123"}]}
        with patch.object(scraper, "_request", return_value=SimpleNamespace(json=lambda: payload)):
            rows = scraper._api_jobs("https://boards.greenhouse.io/acme", ("greenhouse", "acme"), "Acme")
        self.assertEqual(len(rows), 1)
        payload["meta"]["total"] = 2
        with patch.object(scraper, "_request", return_value=SimpleNamespace(json=lambda: payload)):
            with self.assertRaisesRegex(scraper.ScrapeFailure, "returned 1 of 2"):
                scraper._api_jobs("https://boards.greenhouse.io/acme", ("greenhouse", "acme"), "Acme")

    def test_lever_adapter_fetches_all_posting_pages(self):
        first_page = [{"id": str(i), "text": f"Role {i}", "hostedUrl": f"https://jobs.lever.co/acme/{i}"} for i in range(100)]
        second_page = [{"id": "100", "text": "Role 100", "hostedUrl": "https://jobs.lever.co/acme/100"}]
        responses = [SimpleNamespace(json=lambda rows=page: rows) for page in (first_page, second_page)]
        with patch.object(scraper, "_request", side_effect=responses) as request:
            rows = scraper._api_jobs("https://jobs.lever.co/acme", ("lever", "acme"), "Acme")
        self.assertEqual(len(rows), 101)
        self.assertEqual(request.call_count, 2)
        self.assertIn("skip=100", request.call_args_list[1].args[0])

    def test_smartrecruiters_public_board_uses_group_pages_and_card_counts(self):
        page0 = '''<div class="js-openings-load" data-groups-pages="2" data-page="0" data-more="/Acme/api/groups">
          <section class="js-group" data-qty="2"><h3 class="opening-title">Austin, TX</h3>
            <ul><li class="opening-job job"><a class="js-job-ad-link" href="https://jobs.smartrecruiters.com/Acme/100"><h4 class="job-title">GIS Analyst</h4><span class="spl-me-1">Full-time</span></a></li>
            <li class="opening-job job"><a class="js-job-ad-link" href="https://jobs.smartrecruiters.com/Acme/101"><h4 class="job-title">Field Engineer</h4></a></li></ul></section></div>'''
        page1 = '''<section class="js-group" data-qty="1"><h3 class="opening-title">Remote</h3>
            <ul><li class="opening-job job"><a class="js-job-ad-link" href="https://jobs.smartrecruiters.com/Acme/102"><h4 class="job-title">Project Manager</h4></a></li></ul></section>'''
        def detail(url, title):
            posting = {"@type": "JobPosting", "url": url, "title": title,
                       "description": "Lead detailed project work and coordinate delivery. " * 8}
            return '<script type="application/ld+json">' + json.dumps(posting) + '</script>'
        responses = [
            SimpleNamespace(status_code=200, url="https://careers.smartrecruiters.com/Acme", text=page0),
            SimpleNamespace(status_code=200, url="https://careers.smartrecruiters.com/Acme/api/groups?page=1", text=page1),
            SimpleNamespace(status_code=200, url="https://jobs.smartrecruiters.com/Acme/100", text=detail("https://jobs.smartrecruiters.com/Acme/100", "GIS Analyst")),
            SimpleNamespace(status_code=200, url="https://jobs.smartrecruiters.com/Acme/101", text=detail("https://jobs.smartrecruiters.com/Acme/101", "Field Engineer")),
            SimpleNamespace(status_code=200, url="https://jobs.smartrecruiters.com/Acme/102", text=detail("https://jobs.smartrecruiters.com/Acme/102", "Project Manager")),
        ]
        with patch.object(scraper, "_request", side_effect=responses) as request:
            jobs, complete, notes = scraper._smartrecruiters_jobs("https://jobs.smartrecruiters.com/Acme/100", "Acme", "Acme Inc.")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 3)
        self.assertEqual(jobs[0]["title"], "GIS Analyst")
        self.assertEqual(jobs[0]["location"], "Austin, TX")
        self.assertEqual(jobs[0]["raw"]["employment_type"], "Full-time")
        self.assertGreater(len(jobs[0]["description_text"]), 200)
        self.assertTrue(all(job["raw"]["smartrecruiters_detail_complete"] for job in jobs))
        self.assertEqual(request.call_args_list[1].args[0], "https://careers.smartrecruiters.com/Acme/api/groups?page=1")

    def test_scrape_source_dispatches_smartrecruiters_to_public_board_adapter(self):
        source = {
            "url": "https://careers.smartrecruiters.com/Acme",
            "normalized_url": "https://careers.smartrecruiters.com/acme",
            "source_urls": ["https://careers.smartrecruiters.com/Acme"],
            "evidence_urls": [],
            "employers": ["Acme Inc."],
            "employer_keys": ["company_id:1"],
        }
        job = {"title": "GIS Analyst", "company": "Acme Inc.", "source_url": "https://jobs.smartrecruiters.com/Acme/100", "external_job_id": "100", "raw": {}}
        with patch.object(scraper, "_smartrecruiters_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "Acme", "Acme Inc.")
        self.assertEqual(result["method"], "public_board_pagination:smartrecruiters-v2")
        self.assertTrue(result["complete"])

    def test_scrape_source_dispatches_applicantpro_to_sitemap_adapter(self):
        url = "https://mgccontractors.applicantpro.com/jobs/"
        source = {"url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [], "employers": ["MGC Contractors"], "employer_keys": ["mgc"]}
        job = {"title": "Field Engineer", "source_url": "https://www.applicantpro.com/openings/mgccontractors/jobs/101", "external_job_id": "101", "raw": {}}
        with patch.object(scraper, "_applicantpro_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(url, "mgccontractors", "MGC Contractors")
        self.assertEqual(result["method"], "public_sitemap_postings:applicantpro-v1")
        self.assertTrue(result["complete"])

    def test_generic_career_page_uses_linked_applicantstack_adapter(self):
        page = SimpleNamespace(status_code=200, url="https://example.com/careers", text='<a href="https://gis.applicantstack.com/x/openings?sort=1">Open roles</a>')
        job = {"title": "Field Engineer", "source_url": "https://gis.applicantstack.com/x/detail/id", "external_job_id": "id", "raw": {}}
        with patch.object(scraper, "_request", return_value=page), patch.object(scraper, "_applicantstack_jobs", return_value=([job], True, [])) as adapter:
            jobs, method, complete, notes = scraper._crawl_generic("https://example.com/careers", "Example")
        adapter.assert_called_once_with("https://gis.applicantstack.com/x/openings?sort=1", "gis", "Example")
        self.assertEqual(jobs, [job])
        self.assertTrue(complete)

    def test_jobvite_sources_are_held_without_network_requests(self):
        source = {
            "url": "https://jobs.jobvite.com/acme",
            "normalized_url": "https://jobs.jobvite.com/acme",
            "source_urls": ["https://jobs.jobvite.com/acme"],
            "evidence_urls": [],
            "employers": ["Acme"],
            "employer_keys": ["acme"],
        }
        with patch.object(scraper, "_request") as request:
            result = scraper.scrape_source(source)
        request.assert_not_called()
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["method"], "policy_hold")
        self.assertFalse(result["complete"])
        self.assertEqual(result["jobs"], [])

    def test_paycom_and_ukg_sources_are_held_without_network_requests(self):
        for url, reason in (
            ("https://www.paycomonline.net/v4/ats/web.php/portal/example/career-page", "Paycom terms"),
            ("https://recruiting.ultipro.com/acme/JobBoard/example", "UKG source"),
            ("https://airdistribution.rec.pro.ukg.net/acme/JobBoard/example", "UKG source"),
            ("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html", "ADP job access"),
            ("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html", "ADP job access"),
        ):
            with self.subTest(url=url):
                source = {
                    "url": url,
                    "normalized_url": url,
                    "source_urls": [url],
                    "evidence_urls": [],
                    "employers": ["Acme"],
                    "employer_keys": ["acme"],
                }
                with patch.object(scraper, "_request") as request:
                    result = scraper.scrape_source(source)
                request.assert_not_called()
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["method"], "policy_hold")
                self.assertFalse(result["complete"])
                self.assertIn(reason, result["error"])

    def test_iSolved_sources_are_held_without_network_requests(self):
        for url in (
            "https://s2techllc.isolvedhire.com/jobs/",
            "https://secure6.saashr.com/ta/6158859.careers",
        ):
            with self.subTest(url=url):
                source = {"url": url, "normalized_url": url, "source_urls": [url], "evidence_urls": [], "employers": ["Example"], "employer_keys": ["example"]}
                with patch.object(scraper, "_request") as request:
                    result = scraper.scrape_source(source)
                request.assert_not_called()
                self.assertEqual(result["status"], "blocked")
                self.assertEqual(result["method"], "policy_hold")

    def test_robots_crawl_delay_is_respected_as_minimum_host_gap(self):
        self.assertEqual(scraper._minimum_host_gap(None), 1.0)
        rules = scraper.urllib.robotparser.RobotFileParser()
        rules.parse(["User-agent: *", "Crawl-delay: 5"])
        self.assertEqual(scraper._minimum_host_gap(rules), 5.0)

    def test_applicantpro_sitemap_and_board_count_must_match(self):
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.applicantpro.com/openings/acme/jobs/101</loc><lastmod>2026-11-04</lastmod></url>
          <url><loc>https://www.applicantpro.com/openings/acme/jobs/102</loc><lastmod>2026-11-04</lastmod></url>
          <url><loc>https://www.applicantpro.com/openings/acme/jobs/</loc><lastmod>2026-11-05</lastmod></url>
        </urlset>'''

        def page(job_id, title):
            return f'''<script type="application/ld+json">{{
              "@context":"https://schema.org","@type":"JobPosting","title":"{title}",
              "url":"https://www.applicantpro.com/openings/acme/jobs/{job_id}",
              "description":"<p>Public posting details</p>","identifier":{{"value":"{job_id}"}}
            }}</script>'''

        def fake_request(url, **kwargs):
            parsed = scraper.urllib.parse.urlparse(url)
            if parsed.path == "/job_site_map.xml":
                return SimpleNamespace(status_code=200, content=sitemap)
            if parsed.path == "/jobs/":
                return SimpleNamespace(status_code=200, text="<p>Showing 1 - 2 of 2 jobs</p>")
            job_id = parsed.path.rsplit("/", 1)[-1]
            title = "Field Engineer" if job_id == "101" else "GIS Analyst"
            return SimpleNamespace(status_code=200, text=page(job_id, title), url=url)

        with patch.object(scraper, "_request", side_effect=fake_request):
            jobs, complete, notes = scraper._applicantpro_jobs("https://acme.applicantpro.com/", "acme", "Acme")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 2)
        self.assertEqual({job["title"] for job in jobs}, {"Field Engineer", "GIS Analyst"})
        self.assertTrue(all(job["description_text"] == "Public posting details" for job in jobs))

    def test_applicantpro_count_mismatch_marks_source_incomplete(self):
        self.assertEqual(scraper._applicantpro_board_count("<div>55 jobs</div>"), 55)
        self.assertEqual(scraper._applicantpro_board_count("<p>Showing 1 - 74 of 74 jobs</p>"), 74)
        self.assertIsNone(scraper._applicantpro_board_count("<p>Open roles</p>"))

    def test_applicantpro_can_use_complete_tenant_sitemap_when_static_total_is_absent(self):
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.applicantpro.com/openings/acme/jobs/101</loc></url>
          <url><loc>https://www.applicantpro.com/openings/acme/jobs/</loc></url>
        </urlset>'''
        detail = '''<script type="application/ld+json">{
          "@context":"https://schema.org","@type":"JobPosting","title":"Field Engineer",
          "url":"https://www.applicantpro.com/openings/acme/jobs/101","description":"<p>Role details</p>"
        }</script>'''

        def fake_request(url, **kwargs):
            if url.endswith("job_site_map.xml"):
                return SimpleNamespace(status_code=200, content=sitemap)
            if url.endswith("/jobs/"):
                return SimpleNamespace(status_code=200, text="<h1>Current Job Listings</h1>")
            return SimpleNamespace(status_code=200, text=detail, url=url)

        with patch.object(scraper, "_request", side_effect=fake_request):
            jobs, complete, notes = scraper._applicantpro_jobs("https://acme.applicantpro.com/jobs/", "acme", "Acme")
        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 1)
        self.assertTrue(any("completeness relies on the tenant sitemap" in note for note in notes))

    def test_applicantstack_validates_listing_total_and_scrapes_details(self):
        html = '''<table><tbody>
          <tr><td><a href="https://gis.applicantstack.com/x/detail/job-101?sort=1">Field Engineer</a></td></tr>
          <tr><td><a href="https://gis.applicantstack.com/x/detail/job-102?sort=1">GIS Analyst</a></td></tr>
        </tbody></table><div class="tablepager">Showing 1 - 2 of 2</div>'''

        def detail(url, title):
            return f'''<script type="application/ld+json">{{
              "@context":"https://schema.org","@type":"JobPosting","title":"{title}",
              "url":"{url}","description":"<p>Public details</p>"
            }}</script>'''

        def fake_request(url, **kwargs):
            if "/x/openings" in url:
                return SimpleNamespace(status_code=200, text=html)
            title = "Field Engineer" if "job-101" in url else "GIS Analyst"
            return SimpleNamespace(status_code=200, text=detail(url, title), url=url)

        with patch.object(scraper, "_request", side_effect=fake_request) as request:
            jobs, complete, notes = scraper._applicantstack_jobs("https://gis.applicantstack.com/x/openings?sort=1", "gis", "GIS Field Services")
        self.assertTrue(complete, notes)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(len(jobs), 2)
        self.assertEqual({job["title"] for job in jobs}, {"Field Engineer", "GIS Analyst"})

    def test_applicantstack_incomplete_page_window_is_not_ready(self):
        self.assertEqual(scraper._applicantstack_page_window("<div>Showing 1 - 50 of 74</div>"), (1, 50, 74))
        self.assertIsNone(scraper._applicantstack_page_window("<div>Open positions</div>"))

    def test_taleo_enterprise_sitemap_scrapes_each_detail_and_uses_job_number(self):
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=101</loc></url>
          <url><loc>https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=102</loc></url>
        </urlset>'''

        def fake_request(url, **kwargs):
            if "/sitemap.jss?" in url:
                return SimpleNamespace(status_code=200, content=sitemap)
            if "job=" not in scraper.urllib.parse.urlparse(url).query:
                return SimpleNamespace(status_code=200, content=b"", text="<html><h1>Career Board</h1></html>", url=url)
            number = scraper.urllib.parse.parse_qs(scraper.urllib.parse.urlparse(url).query)["job"][0]
            return SimpleNamespace(status_code=200, url=url, text=f"<html><main><h1>Engineer {number}</h1><div class='description'>{'Plan public infrastructure. ' * 6}</div></main></html>")

        with patch.object(scraper, "_request", side_effect=fake_request) as request:
            jobs, complete, notes = scraper._taleo_jobs("https://hdr.taleo.net/careersection/ex/jobsearch.ftl?lang=en", "ex", "HDR")
        self.assertTrue(complete, notes)
        self.assertEqual(request.call_count, 4)
        self.assertEqual([job["external_job_id"] for job in jobs], ["101", "102"])
        self.assertEqual([job["title"] for job in jobs], ["Engineer 101", "Engineer 102"])

    def test_taleo_sitemap_index_selects_matching_portal_only(self):
        index = b'''<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://hdr.taleo.net/careersection/ex/sitemap.xml</loc></sitemap>
          <sitemap><loc>https://hdr.taleo.net/careersection/Pipeline/sitemap.xml</loc></sitemap>
        </sitemapindex>'''
        child = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=101</loc></url>
        </urlset>'''

        def fake_request(url, **kwargs):
            if "portalCode=ex" in url:
                return SimpleNamespace(status_code=200, content=index)
            if "Pipeline" in url:
                self.fail("adapter must not fetch a non-matching Taleo portal")
            if "/sitemap.xml" in url:
                return SimpleNamespace(status_code=200, content=child)
            if "job=" not in scraper.urllib.parse.urlparse(url).query:
                return SimpleNamespace(status_code=200, content=b"", text="<html><h1>Career Board</h1></html>", url=url)
            return SimpleNamespace(status_code=200, url=url, text="<h1>Engineer</h1>")

        with patch.object(scraper, "_request", side_effect=fake_request):
            jobs, complete, notes = scraper._taleo_jobs("https://hdr.taleo.net/careersection/ex/jobsearch.ftl", "ex", "HDR")
        self.assertFalse(complete)
        self.assertEqual(jobs, [])
        self.assertTrue(any("lacked a usable title/description" in note for note in notes))

    def test_taleo_template_label_is_not_promoted_to_job_even_with_description_text(self):
        sitemap = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://hdr.taleo.net/careersection/ex/jobdetail.ftl?job=101</loc></url>
        </urlset>'''

        def fake_request(url, **kwargs):
            if "/sitemap.jss?" in url:
                return SimpleNamespace(status_code=200, content=sitemap)
            if "job=" not in scraper.urllib.parse.urlparse(url).query:
                return SimpleNamespace(status_code=200, content=b"", text="<html><h1>Career Board</h1></html>", url=url)
            return SimpleNamespace(status_code=200, url=url, text=f"<main><h2>Primary Location</h2><div class='description'>{'Generic portal copy. ' * 8}</div></main>")

        with patch.object(scraper, "_request", side_effect=fake_request):
            jobs, complete, notes = scraper._taleo_jobs("https://hdr.taleo.net/careersection/ex/jobsearch.ftl", "ex", "HDR")
        self.assertEqual(jobs, [])
        self.assertFalse(complete)
        self.assertTrue(any("lacked a usable title/description" in note for note in notes))

    def test_ingest_batches_carry_run_id_and_namespace_external_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.jsonl"
            rows = [
                {"title": "Engineer", "company": "Acme", "source_url": "https://acme.example/jobs/1", "external_job_id": "1", "raw": {"career_source_board": "ats:acme"}},
                {"title": "Analyst", "company": "Acme", "source_url": "https://acme.example/jobs/2", "external_job_id": "2", "raw": {"career_source_board": "ats:acme"}},
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            responses = [
                SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"staged": 1, "skipped": 0, "runId": "run-123"}),
                SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"staged": 1, "skipped": 1}),
            ]

            class FakeSession:
                calls = []

                def post(self, url, **kwargs):
                    self.calls.append((url, kwargs))
                    return responses.pop(0)

            with patch.object(scraper.requests, "Session", return_value=FakeSession()):
                staged, skipped = scraper.post_batches(path, "https://talent.example", "secret", batch_size=1)
            self.assertEqual((staged, skipped), (2, 1))
            self.assertEqual(len(FakeSession.calls), 2)
            first_payload = FakeSession.calls[0][1]["json"]
            second_payload = FakeSession.calls[1][1]["json"]
            self.assertTrue(first_payload["jobs"][0]["external_job_id"].startswith("career:"))
            self.assertEqual(second_payload["runId"], "run-123")

    def test_ingest_batch_retries_transient_http_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.jsonl"
            path.write_text(json.dumps({"title": "Engineer", "company": "Acme", "source_url": "https://acme.example/jobs/1", "external_job_id": "1"}) + "\n", encoding="utf-8")
            calls = []

            class FakeResponse:
                def __init__(self, failure):
                    self.failure = failure

                def raise_for_status(self):
                    if self.failure:
                        raise scraper.requests.HTTPError("temporary failure")

                def json(self):
                    return {"staged": 1, "skipped": 0}

            class FakeSession:
                def post(self, url, **kwargs):
                    calls.append(kwargs)
                    return FakeResponse(len(calls) < 3)

            with patch.object(scraper.requests, "Session", return_value=FakeSession()), patch.object(scraper.time, "sleep") as sleep:
                self.assertEqual(scraper.post_batches(path, "https://talent.example", "secret", batch_size=1), (1, 0))
            self.assertEqual(len(calls), 3)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4])

    def test_workday_uses_initial_total_when_later_pages_report_zero(self):
        first_rows = [{"title": f"Role {i}", "externalPath": f"/job/{i}", "bulletFields": [str(i)]} for i in range(20)]
        final_rows = [{"title": "Role 20", "externalPath": "/job/20", "bulletFields": ["20"]}]
        payloads = [
            {"total": 21, "jobPostings": first_rows},
            {"total": 0, "jobPostings": final_rows},
        ]
        responses = [SimpleNamespace(json=lambda payload=page: payload) for page in payloads]
        with patch.object(scraper, "_request_post", side_effect=responses) as request:
            rows = scraper._api_jobs("https://acme.wd5.myworkdayjobs.com/External", ("workday", "acme|External"), "Acme")
        self.assertEqual(len(rows), 21)
        self.assertEqual(request.call_count, 2)

    def test_workday_rejects_a_truncated_search_result(self):
        first_rows = [{"title": "Role 1", "externalPath": "/job/1", "bulletFields": ["1"]}]
        payloads = [
            {"total": 2, "jobPostings": first_rows},
            {"total": 0, "jobPostings": []},
        ]
        responses = [SimpleNamespace(json=lambda payload=page: payload) for page in payloads]
        with patch.object(scraper, "_request_post", side_effect=responses):
            with self.assertRaisesRegex(scraper.ScrapeFailure, "ended at 1 of 2"):
                scraper._api_jobs("https://acme.wd5.myworkdayjobs.com/External", ("workday", "acme|External"), "Acme")

    def test_resume_retries_successes_from_an_older_adapter_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.jsonl"
            path.write_text(json.dumps({"url": "https://example.com/jobs", "status": "scraped", "complete": True, "adapter_version": "old"}) + "\n", encoding="utf-8")
            self.assertEqual(scraper._read_done(path), {})

    def test_skip_attempted_resumes_unseen_groups_and_keeps_other_resume_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            tracker = Path(tmp) / "tracker.csv"
            tracker.write_text(
                "employer_key,employer_name,career_page_status,career_page_url,evidence_url\n"
                "alpha,Alpha,verified_official,https://alpha.example/careers,https://alpha.example\n"
                "beta,Beta,verified_official,https://beta.example/careers,https://beta.example\n"
                "gamma,Gamma,verified_official,https://gamma.example/careers,https://gamma.example\n",
                encoding="utf-8",
            )
            output_dir = Path(tmp) / "output"
            output_dir.mkdir()
            results = output_dir / "source_results.jsonl"
            prior = [
                {"url": "https://alpha.example/careers/", "status": "partial", "complete": False, "adapter_version": scraper.ADAPTER_VERSION},
                {"url": "https://beta.example/careers", "status": "error", "complete": False, "adapter_version": "old"},
                {"url": "https://gamma.example/careers", "status": "no_jobs", "complete": True, "adapter_version": scraper.ADAPTER_VERSION},
            ]
            results.write_text("invalid json\n" + "\n".join(json.dumps(row) for row in prior) + "\n", encoding="utf-8")

            def fake_scrape(source):
                return {**source, "adapter_version": scraper.ADAPTER_VERSION, "status": "no_jobs", "method": "test", "complete": True, "notes": [], "jobs": [], "job_count": 0, "error": None}

            argv = ["employer_career_ingest.py", "--input", str(tracker), "--output-dir", str(output_dir), "--workers", "1"]
            with patch.object(scraper, "scrape_source", side_effect=fake_scrape) as scrape, patch("sys.argv", argv + ["--skip-attempted"]):
                self.assertEqual(scraper.main(), 0)
                self.assertEqual([call.args[0]["url"] for call in scrape.call_args_list], ["https://beta.example/careers"])
            with patch.object(scraper, "scrape_source", side_effect=fake_scrape) as scrape, patch("sys.argv", argv):
                self.assertEqual(scraper.main(), 0)
                self.assertEqual([call.args[0]["url"] for call in scrape.call_args_list], ["https://alpha.example/careers"])
            with patch.object(scraper, "scrape_source", side_effect=fake_scrape) as scrape, patch("sys.argv", argv + ["--include-completed", "--skip-attempted"]):
                self.assertEqual(scraper.main(), 0)
                self.assertEqual(len(scrape.call_args_list), 3)

    def test_readiness_report_prefers_new_adapter_and_keeps_its_completed_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.jsonl"
            rows = [
                {"url": "https://example.com/careers", "normalized_url": "https://example.com/careers", "adapter_version": "v1", "method": "sitemap_jsonld", "complete": True, "status": "scraped"},
                {"url": "https://example.com/careers", "normalized_url": "https://example.com/careers", "adapter_version": "v1", "method": "public_board_adapter", "complete": True, "status": "scraped"},
                {"url": "https://example.com/careers", "normalized_url": "https://example.com/careers", "adapter_version": "v1", "method": "public_board_adapter", "complete": False, "status": "error"},
            ]
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            selected = report._read_results(path, "v1")
        self.assertEqual(selected["https://example.com/careers"]["method"], "public_board_adapter")
        self.assertTrue(selected["https://example.com/careers"]["complete"])

    def test_readiness_report_excludes_legacy_and_other_version_job_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = root / "tracker.csv"
            results = root / "results.jsonl"
            jobs = root / "jobs.jsonl"
            tracker.write_text(
                "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
                "verified_official,https://example.com/careers,,Example Co,company_id:1\n",
                encoding="utf-8",
            )
            results.write_text(json.dumps({
                "url": "https://example.com/careers", "normalized_url": "https://example.com/careers",
                "adapter_version": "v10", "method": "sitemap_structured_data", "complete": True,
                "status": "scraped", "job_count": 1,
            }) + "\n", encoding="utf-8")
            current = {
                "title": "Current title", "company": "Example Co", "source_url": "https://example.com/jobs/42",
                "external_job_id": "42", "description_text": "Full job duties and qualifications. " * 8,
                "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v10"},
            }
            old_without_version = {**current, "title": "Legacy title", "raw": {"career_source_url": "https://example.com/careers"}}
            old_version = {**current, "title": "Old adapter title", "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v9"}}
            jobs.write_text("".join(json.dumps(item) + "\n" for item in (old_without_version, old_version, current)), encoding="utf-8")
            summary = report.build_report(tracker, results, jobs, root / "readiness", "v10")
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(summary["eligible_payload_rows_from_complete_groups"], 1)
        self.assertEqual(summary["unique_integration_ready_job_payloads"], 1)
        self.assertEqual([item["title"] for item in ready], ["Current title"])

    def test_readiness_holds_broken_workday_links_short_descriptions_and_application_forms(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = root / "tracker.csv"
            results = root / "results.jsonl"
            jobs = root / "jobs.jsonl"
            tracker.write_text(
                "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
                "verified_official,https://acme.wd1.myworkdayjobs.com/Acme,,Acme,company_id:1\n"
                "verified_official,https://example.com/careers,,Example,company_id:2\n",
                encoding="utf-8",
            )
            results.write_text("".join(json.dumps({
                "url": url, "adapter_version": "v15", "method": "ats_api", "complete": True,
                "status": "scraped", "job_count": 1 if "workday" in url else 4,
            }) + "\n" for url in (
                "https://acme.wd1.myworkdayjobs.com/Acme", "https://example.com/careers",
            )), encoding="utf-8")
            long_description = "Full job duties and qualifications. " * 8
            payloads = [
                {"title": "Broken Workday", "company": "Acme", "source_url": "https://acme.wd1.myworkdayjobs.com/job/role_1", "external_job_id": "1", "description_text": long_description, "raw": {"career_source_url": "https://acme.wd1.myworkdayjobs.com/Acme", "adapter_version": "v15", "ats": "workday"}},
                {"title": "Ready role", "company": "Example", "source_url": "https://example.com/jobs/2", "external_job_id": "2", "description_text": "", "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v15"}},
                {"title": "Ready role", "company": "Example", "source_url": "https://example.com/jobs/2", "external_job_id": "2", "description_text": long_description, "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v15"}},
                {"title": "Application form", "company": "Example", "source_url": "https://example.com/jobs/3/apps/new", "external_job_id": "3", "description_text": long_description, "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v15"}},
                {"title": "Short detail", "company": "Example", "source_url": "https://example.com/jobs/4", "external_job_id": "4", "description_text": "Too short", "raw": {"career_source_url": "https://example.com/careers", "adapter_version": "v15"}},
            ]
            jobs.write_text("".join(json.dumps(item) + "\n" for item in payloads), encoding="utf-8")
            summary = report.build_report(tracker, results, jobs, root / "readiness", "v15")
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(summary["eligible_payload_rows_from_complete_groups"], 5)
        self.assertEqual(summary["unique_payloads_from_complete_groups"], 4)
        self.assertEqual(summary["unique_integration_ready_job_payloads"], 1)
        self.assertEqual(summary["payload_hold_counts_by_reason"], {
            "application_form_url": 1,
            "description_would_trigger_deep_fetch": 1,
            "invalid_or_unverified_job_url": 1,
        })
        self.assertEqual(summary["source_groups_with_payload_holds"], 2)
        self.assertEqual(ready[0]["title"], "Ready role")

    def test_readiness_report_merges_complete_old_sources_with_newer_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = root / "tracker.csv"
            results_v11 = root / "results-v11.jsonl"
            results_v12 = root / "results-v12.jsonl"
            jobs_v11 = root / "jobs-v11.jsonl"
            jobs_v12 = root / "jobs-v12.jsonl"
            tracker.write_text(
                "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
                "verified_official,https://example-a.com/careers,,Example A,company_id:1\n"
                "verified_official,https://example-b.com/careers,,Example B,company_id:2\n",
                encoding="utf-8",
            )
            rows = [
                {"url": "https://example-a.com/careers", "normalized_url": "https://example-a.com/careers", "adapter_version": "v11", "method": "sitemap", "complete": True, "status": "scraped", "job_count": 1},
                {"url": "https://example-b.com/careers", "normalized_url": "https://example-b.com/careers", "adapter_version": "v11", "method": "sitemap", "complete": False, "status": "partial", "job_count": 1},
                {"url": "https://example-b.com/careers", "normalized_url": "https://example-b.com/careers", "adapter_version": "v12", "method": "board_count", "complete": True, "status": "scraped", "job_count": 1},
            ]
            results_v11.write_text("".join(json.dumps(row) + "\n" for row in rows[:2]), encoding="utf-8")
            results_v12.write_text(json.dumps(rows[2]) + "\n", encoding="utf-8")
            payloads = [
                {"title": "A current", "company": "Example A", "source_url": "https://example-a.com/jobs/1", "external_job_id": "1", "description_text": "Full job duties and qualifications. " * 8, "raw": {"career_source_url": "https://example-a.com/careers", "adapter_version": "v11"}},
                {"title": "B stale partial", "company": "Example B", "source_url": "https://example-b.com/jobs/1", "external_job_id": "1", "description_text": "Full job duties and qualifications. " * 8, "raw": {"career_source_url": "https://example-b.com/careers", "adapter_version": "v11"}},
                {"title": "B retried", "company": "Example B", "source_url": "https://example-b.com/jobs/1", "external_job_id": "1", "description_text": "Full job duties and qualifications. " * 8, "raw": {"career_source_url": "https://example-b.com/careers", "adapter_version": "v12"}},
            ]
            jobs_v11.write_text("".join(json.dumps(item) + "\n" for item in payloads[:2]), encoding="utf-8")
            jobs_v12.write_text(json.dumps(payloads[2]) + "\n", encoding="utf-8")
            summary = report.build_report(
                tracker,
                [results_v11, results_v12],
                [jobs_v11, jobs_v12],
                root / "readiness",
                "v11,v12",
            )
            ready = [json.loads(line) for line in Path(summary["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
        self.assertEqual(summary["complete_source_groups"], 2)
        self.assertEqual(summary["unique_integration_ready_job_payloads"], 2)
        self.assertEqual({item["title"] for item in ready}, {"A current", "B retried"})

    def test_readiness_report_requires_new_generic_sitemap_revalidation_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tracker = root / "tracker.csv"
            results = root / "results.jsonl"
            jobs = root / "jobs.jsonl"
            tracker.write_text(
                "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
                + "".join(f"verified_official,https://{key}.example/careers,,{key},company_id:{key}\n" for key in "ACDE"),
                encoding="utf-8",
            )
            rows = [
                {"url": f"https://{key}.example/careers", "adapter_version": version, "method": method, "complete": complete, "status": status, "job_count": 1}
                for key, version, method, complete, status in (
                    ("A", "v11", "sitemap_structured_data", True, "scraped"),
                    ("C", "v11", "sitemap_structured_data", True, "scraped"),
                    ("C", "v14", "sitemap_structured_data", True, "scraped"),
                    ("D", "v11", "ats_api:lever", True, "scraped"),
                    ("E", "v11", "sitemap_structured_data", True, "scraped"),
                    ("E", "v14", "sitemap_structured_data", False, "partial"),
                )
            ]
            results.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            payloads = [
                {"title": f"{key} {version}", "company": key, "source_url": f"https://{key}.example/jobs/{version}", "external_job_id": f"{key}-{version}", "description_text": "Full job duties and qualifications. " * 8, "raw": {"career_source_url": f"https://{key}.example/careers", "adapter_version": version}}
                for key, version in (("A", "v11"), ("C", "v11"), ("C", "v14"), ("D", "v11"), ("E", "v11"))
            ]
            jobs.write_text("".join(json.dumps(row) + "\n" for row in payloads), encoding="utf-8")
            baseline = report.build_report(tracker, results, jobs, root / "baseline", "v11,v14")
            gated = report.build_report(tracker, results, jobs, root / "gated", "v11,v14", "v14")
            ready = [json.loads(line) for line in Path(gated["ready_jobs_path"]).read_text(encoding="utf-8").splitlines()]
            with Path(gated["source_dispositions_path"]).open(encoding="utf-8-sig", newline="") as dispositions_file:
                dispositions = {row["employers"]: row for row in csv.DictReader(dispositions_file)}
        self.assertEqual(baseline["unique_integration_ready_job_payloads"], 3)
        self.assertEqual(gated["needs_revalidation_source_groups"], 2)
        self.assertEqual(gated["status_counts_by_source_group"]["needs_revalidation"], 2)
        self.assertEqual(gated["complete_source_groups"], 2)
        self.assertEqual({job["title"] for job in ready}, {"C v14", "D v11"})
        self.assertEqual(dispositions["A"]["status"], "needs_revalidation")
        self.assertEqual(dispositions["E"]["status"], "needs_revalidation")
        self.assertEqual(dispositions["C"]["status"], "scraped")

    def test_html_fallback_only_accepts_job_detail_routes_with_real_headings(self):
        self.assertTrue(is_job_detail_url("https://jobs.example.com/careers/1234"))
        self.assertFalse(is_job_detail_url("https://jobs.example.com/careers/search"))
        html = "<nav><h1>Careers</h1></nav><main><h1>Senior GIS Analyst</h1><p>Map route networks.</p></main>"
        job = extract_html_job(html, "https://jobs.example.com/careers/1234", "Example")
        self.assertEqual(job["title"], "Senior GIS Analyst")
        self.assertIn("Map route networks", job["description_text"])

    def test_groups_shared_career_url_without_losing_employer_keys(self):
        data = (
            "career_page_status,career_page_url,evidence_url,employer_name,employer_key\n"
            "verified_official,https://EXAMPLE.com/careers/,https://example.com/about,Example A,company_id:1\n"
            "verified_official_ats_link,https://example.com/careers#jobs,https://example.com/jobs,Example B,company_id:2\n"
            "unresolved,,https://example.org,Example C,company_id:3\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracker.csv"
            path.write_text(data, encoding="utf-8")
            sources = load_sources(path)
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["employers"], ["Example A", "Example B"])
        self.assertEqual(sources[0]["employer_keys"], ["company_id:1", "company_id:2"])
        self.assertEqual(sources[0]["source_urls"], ["https://EXAMPLE.com/careers/", "https://example.com/careers#jobs"])
        self.assertEqual(sources[0]["evidence_urls"], ["https://example.com/about", "https://example.com/jobs"])

    def test_robots_authorization_failures_are_held(self):
        for status in (401, 403):
            root = f"https://robots-{status}.example.com"
            scraper._robots.pop(root, None)
            with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=status)):
                self.assertIsNone(scraper._robots_parser(root))

    def test_robots_404_uses_explicit_unavailable_policy(self):
        root = "https://robots-missing.example.com"
        scraper._robots.pop(root, None)
        with patch.object(scraper, "_request", return_value=SimpleNamespace(status_code=404)):
            rules = scraper._robots_parser(root)
        self.assertIsNotNone(rules)
        self.assertTrue(rules.can_fetch(scraper.UA, root + "/careers"))

    def test_robots_wildcard_is_not_overridden_by_bing_group_substring(self):
        root = "https://robots-bing-match.example.com"
        rules = scraper.urllib.robotparser.RobotFileParser()
        rules.set_url(root + "/robots.txt")
        rules.parse([
            "User-agent: *",
            "Disallow: /",
            "User-agent: bing",
            "Allow: /",
        ])
        self.assertNotIn("bing", scraper.UA.casefold())
        self.assertFalse(rules.can_fetch(scraper.UA, root + "/careers"))

    def test_public_https_url_retries_transient_dns_failure(self):
        resolved = [(None, None, None, None, ("93.184.216.34", 443))]
        with patch.object(scraper.socket, "getaddrinfo", side_effect=[OSError(11001, "temporary DNS failure"), resolved]) as lookup, patch.object(scraper.time, "sleep"):
            parsed = scraper._public_https_url("https://example.com/careers")
        self.assertEqual(parsed.hostname, "example.com")
        self.assertEqual(lookup.call_count, 2)

    def test_request_session_is_reused_within_a_worker(self):
        previous = getattr(scraper._request_session_local, "session", None)
        if previous is not None:
            del scraper._request_session_local.session
        first = second = None
        try:
            first = scraper._thread_session()
            second = scraper._thread_session()
            self.assertIs(first, second)
        finally:
            if first is not None:
                first.close()
            if previous is not None:
                scraper._request_session_local.session = previous

    def test_tls_connection_errors_are_errors_not_policy_holds(self):
        source = {
            "url": "https://example.com/careers",
            "normalized_url": "https://example.com/careers",
            "source_urls": ["https://example.com/careers"],
            "evidence_urls": [], "employers": ["Example"], "employer_keys": ["company_id:1"],
        }
        with patch.object(scraper, "_request", side_effect=scraper.requests.exceptions.SSLError("TLS EOF")):
            result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "error")

    def test_http_source_is_held_by_https_fetch_guard(self):
        source = {
            "url": "http://example.com/careers",
            "normalized_url": "http://example.com/careers",
            "source_urls": ["http://example.com/careers"],
            "evidence_urls": [], "employers": ["Example"], "employer_keys": ["company_id:1"],
        }
        result = scraper.scrape_source(source)
        self.assertEqual(result["status"], "held")

    def test_sitemap_robots_denial_is_not_silently_empty(self):
        rules = scraper.urllib.robotparser.RobotFileParser()
        rules.parse(["User-agent: *", "Disallow: /sitemap.xml"])
        with patch.object(scraper, "_robots_parser", return_value=rules), patch.object(scraper, "_request", side_effect=scraper.ScrapeFailure("robots.txt disallows this URL")):
            urls, complete, notes = scraper._discover_sitemaps("https://example.com/careers")
        self.assertEqual(urls, [])
        self.assertFalse(complete)
        self.assertTrue(any("robots.txt disallows" in note for note in notes))

    def test_malformed_robots_sitemap_is_partial_and_allows_link_fallback(self):
        rules = scraper.urllib.robotparser.RobotFileParser()
        rules.parse(["User-agent: *", "Allow: /"])
        rules.site_maps = lambda: ["https://example.com/sitemap.xml"]
        response = SimpleNamespace(status_code=200, content=b"<!doctype html><html>not a sitemap</html>")
        with patch.object(scraper, "_robots_parser", return_value=rules), patch.object(scraper, "_request", return_value=response):
            urls, complete, notes = scraper._discover_sitemaps("https://example.com/careers")
        self.assertEqual(urls, [])
        self.assertFalse(complete)
        self.assertTrue(any("invalid sitemap XML" in note for note in notes))

    def test_rippling_board_urls_are_detected(self):
        self.assertEqual(_platform("https://ats.rippling.com/aalo-atomics/jobs"), ("rippling", "aalo-atomics/jobs"))
        self.assertEqual(_platform("https://ats.rippling.com/aalo-atomics/jobs/abc-123"), ("rippling", "aalo-atomics/jobs"))

    def test_resume_refreshes_old_complete_public_board_sources_only(self):
        rippling = {"url": "https://ats.rippling.com/sample/jobs"}
        smartrecruiters = {"url": "https://careers.smartrecruiters.com/sample"}
        greenhouse = {"url": "https://boards.greenhouse.io/sample"}
        personio = {"url": "https://sample.jobs.personio.de/"}
        done = {
            rippling["url"]: {"method": "sitemap_jsonld", "complete": True},
            smartrecruiters["url"]: {"method": "ats_api:smartrecruiters", "complete": True},
            greenhouse["url"]: {"method": "ats_api:greenhouse", "complete": True},
            personio["url"]: {"method": "personio_page_fallback:sitemap_jsonld", "complete": True},
        }
        self.assertEqual(scraper._pending_sources([rippling, smartrecruiters, greenhouse, personio], done), [rippling, smartrecruiters])
        done[rippling["url"]] = {"method": "public_board_pagination:rippling", "complete": True}
        done[smartrecruiters["url"]] = {"method": "public_board_pagination:smartrecruiters-v2", "complete": True}
        self.assertEqual(scraper._pending_sources([rippling, smartrecruiters, greenhouse, personio], done), [])

    def test_smartrecruiters_api_host_is_never_called(self):
        with patch.object(scraper, "_request") as request:
            with self.assertRaisesRegex(scraper.ScrapeFailure, "robots-disallowed"):
                scraper._api_jobs("https://careers.smartrecruiters.com/acme", ("smartrecruiters", "acme"), "Acme")
        request.assert_not_called()

    def test_scrape_source_dispatches_rippling_to_paginated_board_adapter(self):
        source = {
            "url": "https://ats.rippling.com/sample/jobs",
            "normalized_url": "https://ats.rippling.com/sample/jobs",
            "source_urls": ["https://ats.rippling.com/sample/jobs"],
            "evidence_urls": [],
            "employers": ["Example Inc."],
            "employer_keys": ["company_id:1"],
        }
        job = {"title": "Engineer", "company": "Example Inc.", "source_url": "https://ats.rippling.com/sample/jobs/id", "external_job_id": "id", "raw": {}}
        with patch.object(scraper, "_rippling_jobs", return_value=([job], True, [])) as adapter:
            result = scraper.scrape_source(source)
        adapter.assert_called_once_with(source["url"], "sample/jobs", "Example Inc.")
        self.assertEqual(result["method"], "public_board_pagination:rippling")
        self.assertTrue(result["complete"])
        self.assertEqual(result["jobs"][0]["raw"]["career_source_board"], "rippling:sample/jobs")

    def test_rippling_paginates_by_reported_total_and_extracts_detail_pages(self):
        def listing_page(page, items):
            state = {
                "items": items,
                "page": page,
                "pageSize": 2,
                "totalItems": 3,
                "totalPages": 2,
            }
            next_data = {"props": {"pageProps": {"dehydratedState": {"queries": [{
                "queryKey": ["board", "sample", "job-posts", False, {"page": page}],
                "state": {"data": state},
            }]}}}}
            return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(next_data) + "</script>"

        rows = [
            {"id": "job-1", "name": "Engineer One", "url": "https://ats.rippling.com/sample/jobs/job-1", "locations": [{"name": "Boston, MA"}]},
            {"id": "job-2", "name": "Engineer Two", "url": "https://ats.rippling.com/sample/jobs/job-2", "locations": []},
            {"id": "job-3", "name": "Engineer Three", "url": "https://ats.rippling.com/sample/jobs/job-3", "locations": []},
        ]

        def detail_page(row):
            post = {
                "uuid": row["id"],
                "name": row["name"],
                "description": {"company": "<p>About Example</p>", "role": "<p>Build reliable systems</p>"},
                "workLocations": ["Boston, MA"],
                "department": {"name": "Engineering"},
                "employmentType": {"label": "Full time", "id": "FULL_TIME"},
                "createdOn": "2026-01-02T00:00:00Z",
                "companyName": "Example Inc.",
            }
            data = {"props": {"pageProps": {"apiData": {"jobPost": post, "jobBoard": {"companyName": "Example Inc."}}}}}
            return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(data) + "</script>"

        def fake_request(url, **kwargs):
            parsed = scraper.urllib.parse.urlparse(url)
            if parsed.path.endswith("/jobs"):
                page = int(scraper.urllib.parse.parse_qs(parsed.query).get("page", ["0"])[0])
                items = rows[:2] if page == 0 else rows[2:]
                return SimpleNamespace(status_code=200, text=listing_page(page, items), url=url)
            row = next(row for row in rows if row["url"] == url)
            return SimpleNamespace(status_code=200, text=detail_page(row), url=url)

        with patch.object(scraper, "_request", side_effect=fake_request):
            jobs, complete, notes = scraper._rippling_jobs("https://ats.rippling.com/sample/jobs", "sample/jobs", "Fallback")

        self.assertTrue(complete, notes)
        self.assertEqual(len(jobs), 3)
        self.assertEqual(jobs[0]["title"], "Engineer One")
        self.assertEqual(jobs[0]["company"], "Example Inc.")
        self.assertIn("Build reliable systems", jobs[0]["description_text"])
        self.assertEqual(jobs[0]["raw"]["employment_type"], "Full time")

    def test_url_cap_marks_sitemap_scan_partial(self):
        rules = scraper.urllib.robotparser.RobotFileParser()
        rules.parse(["User-agent: *", "Allow: /"])
        xml = b'''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/jobs/1</loc></url>
          <url><loc>https://example.com/jobs/2</loc></url>
        </urlset>'''
        response = SimpleNamespace(status_code=200, content=xml)
        with patch.object(scraper, "MAX_JOB_URLS", 1), patch.object(scraper, "_robots_parser", return_value=rules), patch.object(scraper, "_request", return_value=response):
            urls, complete, notes = scraper._discover_sitemaps("https://example.com/careers")
        self.assertEqual(len(urls), 1)
        self.assertFalse(complete)
        self.assertTrue(any("cap reached" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
