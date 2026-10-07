"""Gemini + Google 검색: 주제 조사, 그리고 기기 사진 검색용 조건(영어 장면 묘사·장소·시기) 만들기."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ...i18n import LANG_NAME
from . import gemini
from .gemini import GeminiError
from .limits import MAX_PHOTOS
from .textutil import clip

log = logging.getLogger(__name__)


_RESEARCH_PROMPT = """너는 인스타그램 게시물 리서처야. Google 검색으로 아래 주제를 조사해, 사용자가 원하는 게시물을 뒷받침할 자료를 정리해.
게시물의 컨셉과 형식은 사용자가 정한 [주제]와 [연출 방향]이 절대 기준이고, 너의 조사는 그 내용을 사실로 뒷받침하는 보조 역할이야.

[주제] {prompt}
[연출 방향] {style}
사용자가 준 확정 정보(그대로 신뢰): {notes}

연출 방향이 요구하는 형식에 필요한 자료(예: 이벤트면 기간·조건, 비교형이면 비교 항목)를 우선 찾아.
주제가 정보·방법·제품·서비스처럼 사실이 중요한 내용이면:
1) 한 줄 요약  2) 핵심 사실 6~10개 (정의, 특징, 절차·방법, 조건·비용·주의사항, 최신 변경)  3) 독자가 궁금해할 질문 3개
주제가 감성·일상·여행 기록처럼 분위기가 중요한 내용이면: 관련 배경 지식과 표현에 쓸 만한 사실 몇 줄만.
확인된 사실만 쓰고 추측하지 마. 날짜가 중요한 정보에는 기준 시점을 적어."""


def research(prompt: str, notes: str, style: str = "", *, language: str = "ko") -> tuple[dict[str, Any], str]:
    """(조사 결과 {notes, sources}, 경고). 검색이 안 되면 빈 결과로 계속 진행합니다."""
    text = _RESEARCH_PROMPT.format(prompt=prompt, notes=notes.strip() or "없음", style=style.strip() or "없음")
    text += f"\n\n조사 결과는 {LANG_NAME.get(language, 'English')} 로 써. (게시물 글의 언어는 나중에 [주제]의 언어를 따라 정해.)"
    parts = [{"text": text}]
    try:
        data = gemini.text_call(parts, {"temperature": 0.2}, tools=[{"googleSearch": {}}])
        text = gemini.text_of(data)
        chunks = ((data.get("candidates") or [{}])[0].get("groundingMetadata") or {}).get("groundingChunks") or []
        sources, seen = [], set()
        for ch in chunks:
            web = ch.get("web") or {}
            uri = web.get("uri")
            if uri and uri not in seen:
                seen.add(uri)
                sources.append({"title": (web.get("title") or uri)[:120], "uri": uri})
        return {"notes": text[:6000], "sources": sources[:12]}, ""
    except (GeminiError, KeyError, IndexError, TypeError) as exc:
        log.warning("research skipped: %s", exc)
        return {"notes": "", "sources": []}, f"주제 조사(검색) 실패로 사진·입력 정보만 사용: {exc}"


_PHOTO_QUERY_PROMPT = """사용자가 인스타그램 게시물 주제를 적었어. 사용자 기기의 사진 중에서 이 주제에 맞는 사진을 찾으려고 해.
사진 검색은 이미지 인식 모델(CLIP, 영어 문장만 이해)과 사진의 촬영 위치(GPS)·날짜로 해.

주제: {prompt}
오늘 날짜: {today}

JSON 으로만 답해:
- queries: 이 주제의 사진에 실제로 찍혀 있을 장면을 영어로 짧게 묘사한 문장 3~6개
  (예: 'the Eiffel Tower at sunset', 'a woman posing by the Seine at night', 'a plate of churros with chocolate').
  사람이 찍은 일상 사진처럼 구체적인 피사체·장소·음식·풍경으로. 추상적인 단어(memories, trip, vibe)는 쓰지 마.
- place: 주제에 특정 장소(도시·지역·관광지)가 있으면 {{"name": 장소명, "lat": 위도, "lng": 경도, "radius_km": 반경}}, 없으면 null.
  도시면 반경 25~40, 나라면 300~800, 특정 건물·식당이면 1~3.
- date_from, date_to: 주제에 시기('지난 여름', '2024년 크리스마스', '어제')가 있으면 YYYY-MM-DD, 없으면 null.
- count: 이 게시물에 쓸 사진 수 (주제에 장 수가 있으면 그 수, 없으면 4, 1~8)."""


def photo_query(prompt: str, today: str) -> dict[str, Any]:
    """주제 → 기기 사진 검색 조건 (영어 장면 묘사·장소·날짜·장 수). 실패하면 GeminiError."""
    schema = {
        "type": "OBJECT",
        "properties": {
            "queries": {"type": "ARRAY", "items": {"type": "STRING"}},
            "place": {
                "type": "OBJECT",
                "nullable": True,
                "properties": {
                    "name": {"type": "STRING"},
                    "lat": {"type": "NUMBER"},
                    "lng": {"type": "NUMBER"},
                    "radius_km": {"type": "NUMBER"},
                },
                "required": ["name", "lat", "lng", "radius_km"],
            },
            "date_from": {"type": "STRING", "nullable": True},
            "date_to": {"type": "STRING", "nullable": True},
            "count": {"type": "INTEGER"},
        },
        "required": ["queries", "count"],
    }
    cfg = {"temperature": 0.0, "responseMimeType": "application/json", "responseSchema": schema}  # 같은 주제엔 같은 검색어
    data = gemini.text_call([{"text": _PHOTO_QUERY_PROMPT.format(prompt=prompt[:1000], today=today)}], cfg, budget=55.0, attempt_cap=12.0)  # 짧은 요청
    try:
        raw = json.loads(gemini.text_of(data))
    except ValueError as exc:
        raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
    place = raw.get("place") if isinstance(raw.get("place"), dict) else None
    if place:
        try:
            place = {
                "name": clip(place.get("name"), 80),
                "lat": float(place["lat"]),
                "lng": float(place["lng"]),
                "radius_km": max(0.5, min(1000.0, float(place.get("radius_km") or 30))),
            }
        except (KeyError, TypeError, ValueError):
            place = None
    date_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    return {
        "queries": [clip(q, 120) for q in (raw.get("queries") or []) if str(q).strip()][:6],
        "place": place,
        "date_from": raw.get("date_from") if date_re.match(str(raw.get("date_from") or "")) else None,
        "date_to": raw.get("date_to") if date_re.match(str(raw.get("date_to") or "")) else None,
        "count": max(1, min(MAX_PHOTOS, int(raw.get("count") or 4))),
    }
