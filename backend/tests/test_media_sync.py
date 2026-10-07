"""인스타에서 지운 게시물 정리."""
from backend.models import AutoReplyRule, CommentSentiment, GenerationJob
from backend.services import media_sync
from backend.services.meta_graph import GraphError

GONE, ALIVE = "17999999999999999", "18000000000000001"


class FakeGraph:
    def get(self, media_id, params=None):
        if media_id == GONE:
            raise GraphError(f"Unsupported get request. Object with ID '{media_id}' does not exist")
        return {"id": media_id}


def test_marks_deleted_posts_and_cleans_records(db, account):
    job = GenerationJob(account_id=account.id, prompt="p", media_kind="IMAGE", tone="", status="published",
                        provider="studio/gemini", caption="", hashtags=[], assets=[], ig_media_id=GONE)
    db.add(job)
    db.commit()
    standalone = AutoReplyRule(account_id=account.id, ig_media_id=GONE)
    job_rule = AutoReplyRule(account_id=account.id, job_id=job.id, ig_media_id=GONE)
    alive_rule = AutoReplyRule(account_id=account.id, ig_media_id=ALIVE)
    db.add_all([standalone, job_rule, alive_rule,
                CommentSentiment(account_id=account.id, ig_media_id=GONE, comment_id="c-gone", sentiment="positive", reason="", text="")])
    db.commit()

    result = media_sync.sync_deleted(db, account, FakeGraph(), force=True)

    db.expire_all()
    assert result == {"checked": 2, "deleted": 1}
    assert db.get(GenerationJob, job.id).status == "deleted"
    assert db.get(AutoReplyRule, standalone.id) is None  # 기존 게시물 규칙은 삭제
    assert db.get(AutoReplyRule, job_rule.id).ig_media_id == ""  # 만들기 게시물 규칙은 연결만 끊음
    assert db.get(AutoReplyRule, alive_rule.id) is not None
    assert db.query(CommentSentiment).filter_by(ig_media_id=GONE).count() == 0


def test_throttled_within_a_minute(db, account):
    media_sync._last_run.pop(account.id, None)
    media_sync.sync_deleted(db, account, FakeGraph())
    assert media_sync.sync_deleted(db, account, FakeGraph()) == {"checked": 0, "deleted": 0}
