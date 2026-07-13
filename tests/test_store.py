from crr_radar.store import normalize_url, url_hash


def test_normalize_strips_tracking_and_slash():
    a = "https://www.eba.europa.eu/news/item/?utm_source=x&utm_medium=rss"
    b = "https://WWW.EBA.europa.eu/news/item"
    assert normalize_url(a) == normalize_url(b)
    assert url_hash(a) == url_hash(b)


def test_normalize_keeps_meaningful_query():
    a = "https://example.com/page?id=42"
    b = "https://example.com/page?id=43"
    assert url_hash(a) != url_hash(b)


def test_normalize_drops_fragment():
    assert url_hash("https://example.com/x#section") == url_hash("https://example.com/x")
