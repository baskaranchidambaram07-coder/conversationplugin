"""Widget configuration (M8-T2): every setting checked before anything is published."""

import pytest

from tests.test_public import PUBLIC, document
from ucp.widgets import problems

GOOD_SITES = [
    "https://www.example.ac.uk",
    "https://*.example.ac.uk",  # every subdomain of the customer's own domain
    "https://portal.example.ac.uk:8443",
    "https://xn--bcher-kva.example",  # an internationalised name, in its xn-- form
    "http://localhost:4174",  # local development only
    "http://127.0.0.1:4174",
]

BAD_SITES = {
    "http://www.example.ac.uk": "a page that is not https",
    "https://*.com": "every .com site",
    "https://*.ac.uk": "every UK university",
    "https://*.github.io": "everyone's GitHub pages",
    "https://*.localhost": "a wildcard over local names",
    "https://*": "every site",
    "https://a.*.example.ac.uk": "a wildcard in the middle",
    "https://*.*.example.ac.uk": "two wildcards",
    "https://Example.ac.uk": "capitals, which policies would not match as written",
    "https://bücher.example": "an internationalised name not in its xn-- form",
    "https://example.ac.uk.": "a trailing dot",
    "https://-x.example.ac.uk": "a label starting with a hyphen",
    "https://user@example.ac.uk": "a user name",
    "https://example.ac.uk/": "a path",
    "https://example.ac.uk?x": "a query",
    "https://example.ac.uk:0": "port 0",
    "https://example.ac.uk:70000": "a port out of range",
    "https://example.ac.uk; script-src *": "a second policy smuggled in",
    "https://example.ac.uk 'unsafe-inline'": "a policy keyword smuggled in",
    "example.ac.uk": "no scheme",
    "": "nothing",
}


@pytest.mark.parametrize("site", GOOD_SITES)
def test_the_customers_own_sites_are_accepted(site):
    assert problems({"w_1": document(allowed_domains=[site])}) == []


@pytest.mark.parametrize("site", BAD_SITES, ids=list(BAD_SITES.values()))
def test_a_site_that_would_widen_who_can_show_the_chat_is_refused(site):
    found = problems({"w_1": document(allowed_domains=["https://www.example.ac.uk", site])})

    assert len(found) == 1 and found[0].startswith("w_1: allowed_domains.1: ")


def test_every_problem_in_a_file_is_reported_at_once_naming_the_widget_and_the_field():
    found = problems(
        {
            "w_good": document(),
            "w_bad": document(allowed_domains=["https://*.com"], sign_in="signed_in"),
            "w_worse": document(public={**PUBLIC, "title": ""}, limits={"concurrent_turns": 0}),
        }
    )

    assert [line.split(": ")[:2] for line in found] == [
        ["w_bad", "allowed_domains.0"],  # the sign-in settings are checked once the fields themselves are right
        ["w_worse", "limits.concurrent_turns"],
        ["w_worse", "public.title"],
    ]
    assert problems({"w_bad": document(sign_in="signed_in")})[0].endswith("needs its identity settings")
