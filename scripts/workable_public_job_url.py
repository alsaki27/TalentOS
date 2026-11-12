"""Derive a Workable job-page URL without requesting an application route.

The public Workable account API may expose an ``application_url`` ending in
``/j/<shortcode>/apply``. That path leads into the application flow. A matching
``/j/<shortcode>`` route is the public job page. Callers still need normal
robots checks for any request; this module performs no I/O.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit


_APPLICATION_PATH = re.compile(r"^/j/([A-Za-z0-9]+)/apply/?$")


def job_page_from_application_url(application_url: str | None, external_job_id: str | None) -> str | None:
    """Return a same-host job URL only when the shortcode matches exactly."""
    if not isinstance(application_url, str) or not isinstance(external_job_id, str):
        return None
    try:
        parsed = urlsplit(application_url.strip())
        if (parsed.scheme.lower() != "https" or parsed.hostname != "apply.workable.com"
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.query or parsed.fragment):
            return None
    except ValueError:
        return None
    match = _APPLICATION_PATH.fullmatch(parsed.path)
    if not match or match.group(1).casefold() != external_job_id.strip().casefold():
        return None
    return urlunsplit(("https", "apply.workable.com", f"/j/{match.group(1)}", "", ""))
