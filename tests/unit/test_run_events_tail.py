from pathlib import Path

from acc.app.run_events import read_jsonl_since_offset, read_jsonl_tail_with_offset


def test_read_jsonl_since_offset_returns_records_and_next_offset(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text('{"event_seq":1}\n{"event_seq":2}\n', encoding="utf-8")

    records, offset = read_jsonl_since_offset(log, 0, limit=10)

    assert [record["event_seq"] for record in records] == [1, 2]
    assert offset == log.stat().st_size


def test_read_jsonl_since_offset_reads_only_new_records(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text('{"event_seq":1}\n', encoding="utf-8")
    _, offset = read_jsonl_since_offset(log, 0, limit=10)
    with log.open("a", encoding="utf-8") as handle:
        handle.write('{"event_seq":2}\n')

    records, next_offset = read_jsonl_since_offset(log, offset, limit=10)

    assert [record["event_seq"] for record in records] == [2]
    assert next_offset == log.stat().st_size


def test_read_jsonl_since_offset_next_offset_stops_at_limit(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text(
        '{"event_seq":1}\n{"event_seq":2}\n{"event_seq":3}\n',
        encoding="utf-8",
    )

    records, offset = read_jsonl_since_offset(log, 0, limit=2)
    next_records, next_offset = read_jsonl_since_offset(log, offset, limit=2)

    assert [record["event_seq"] for record in records] == [1, 2]
    assert [record["event_seq"] for record in next_records] == [3]
    assert next_offset == log.stat().st_size


def test_read_jsonl_tail_with_offset_returns_bounded_tail_and_eof_offset(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text(
        '{"event_seq":1}\n{"event_seq":2}\n{"event_seq":3}\n',
        encoding="utf-8",
    )

    records, offset = read_jsonl_tail_with_offset(log, limit=2)

    assert [record["event_seq"] for record in records] == [2, 3]
    assert offset == log.stat().st_size


def test_read_jsonl_tail_with_offset_tolerates_malformed_lines(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text('{"event_seq":1}\n{broken\n{"event_seq":2}\n', encoding="utf-8")

    records, offset = read_jsonl_tail_with_offset(log, limit=10)

    assert records[0]["event_seq"] == 1
    assert records[1]["type"] == "raw_log"
    assert records[2]["event_seq"] == 2
    assert offset == log.stat().st_size
