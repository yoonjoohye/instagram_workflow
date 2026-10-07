"""게시물 구성: 주제·연출 방향·사진으로 장 수, 장별 사진·레이아웃·글, 캡션·해시태그를 Gemini 로 설계합니다."""
from __future__ import annotations

import json
import re
from typing import Any

from ...config import settings
from ...i18n import LANG_NAME
from . import gemini
from .captions import (
    FREE_RULES,
    INSTRUCTION_RULES,
    TEMPLATE_RULES,
    fill_template,
    placeholders,
)
from .fonts import FONTS, font_key
from .gemini import GeminiError
from .imaging import b64, small
from .limits import MAX_SLIDES, MAX_STORIES
from .textutil import clip

_PLAN_PROMPT = """너는 인스타그램 게시물 크리에이티브 디렉터야. 사용자의 주제와 연출 방향을 그대로 실현하는 게시물을 설계해.
정해진 구성이나 장수는 없어.

━━ 1순위 · 절대 기준 (이미지, 이미지 속 글, 캡션 모두 여기에 맞춰. 어떤 것도 이걸 바꾸거나 무시하면 안 돼) ━━
[주제] {prompt}
  ↳ 사용자가 무엇을 올리고 싶은지 적은 메모야. 의도·사실은 반영하되 이 문장을 캡션·이미지 글에 그대로 옮겨 적지는 마.
[연출 방향] {style}{ref_rule}

━━ 2순위 · 사용자 확정 정보 (그대로 사용, 바꾸지 마) ━━
{notes}
※ 아래 캡션 양식 안에 적힌 사실(칸 밖 문장, '[추천인 정보: 코드 ABC123]'처럼 칸 이름 속 정보)도 확정 정보야.

━━ 3순위 · 조사 자료 (Google 검색 요약 — 1순위를 뒷받침하는 사실로만 써. 컨셉·연출·형식을 바꾸는 근거로 쓰지 마. 여기 없는 사실은 지어내지 마) ━━
{research}

━━ 4순위 · 첨부 사진 {n}장 (번호는 0부터 첨부 순서) — 연출에 맞을 때만 써 ━━{refs}

0) requirements: 먼저 [주제]와 [연출 방향]에서 사용자의 요구를 빠짐없이 하나씩 뽑아
  (형식, 장별 지시, 그림체, 글자 표현, 말투, 강조할 내용 등. 예: '첫 장은 배경을 어둡게 하고 후킹 제목', '두 번째 장부터 손글씨 동그라미·화살표로 설명').
  각 요구마다 how 에 어느 장(몇 번째)에 어떻게 반영했는지 구체적으로 적어. 반영하지 못한 요구가 없게 설계해.

1) 형식(format) 정하기 — 주제·컨셉·연출 방향에 나온 형식을 그대로 따르고, 언급이 없으면 가장 잘 맞는 것을 골라:
  인스타툰/웹툰(캐릭터·말풍선 컷), 손글씨 메모(사진이나 종이 위 손글씨·동그라미·화살표 낙서), 인터뷰/Q&A, 이벤트·프로모션 포스터,
  정보 정리형(체크리스트·단계별 안내·비교), 감성 사진/무드보드, 비포·애프터, 인용 한 줄 등. 특정 형식을 기본값처럼 쓰지 마.
2) art_style: 모든 이미지에 똑같이 적용할 그림체를 영어로 구체적으로 (예: 'Instagram webtoon, clean black line art, flat pastel colors, rounded chibi character' /
  'real photo with white hand-drawn iPad marker doodles and handwriting' / 'natural film photography, warm grain').
  참고 이미지가 있으면 그 양식의 그림체·색·레이아웃을 그대로 적고, 없으면 연출 방향을 가장 크게 반영해. 요청이 그림체면 실사로 바꾸지 마.

3) font: 서버가 글자를 얹는 장(overlay/panel/center)에 쓸 글씨체를 골라. 연출 방향에 글씨체 언급이 있으면 그대로 따르고, 없으면 형식에 맞게:
  {fonts}
  게시물 글이 일본어면 반드시 noto_sans_jp (다른 글씨체는 일본어 글자가 없음). 한국어·영어면:
  손글씨 메모면 nanum_pen/gaegu, 날림체면 east_sea_dokdo, 붓글씨·전통·궁서 느낌이면 nanum_brush/song_myung, 우아하면 nanum_myeongjo,
  강한 제목은 black_han_sans/do_hyeon, 귀여우면 jua, 깔끔한 정보형은 pretendard. designed 장의 글자 느낌도 이 글씨체와 맞춰 art_style 에 적어.

슬라이드 규칙
- slides 는 1~{max_slides}장. 형식과 컨셉에 필요한 만큼만. 1장이면 단일 게시물이 돼.
- 장 수: 사용자가 장 수를 정했으면(예: '한 장 짜리', '1장', '3장') 반드시 그 수로 만들어. 사진이 더 많으면 한 장에 합쳐서 맞춰.
- photos: 이 장에 쓸 첨부 사진 번호 목록. 한 장에 여러 사진을 합쳐 쓰려면(필름 콜라주·스크랩북·필름 스트립·비교·그리드 등) 여러 번호를 넣고,
  visual 에 어떻게 한 이미지로 합치는지 적어. 맞는 사진이 없어 새로 만들면 빈 목록 []. 컨셉에 맞지 않는 사진은 안 써도 돼
  (웹툰처럼 그림체면 사진을 그 그림체로 다시 그리는 참고로 써).
- layout 은 슬라이드마다 골라:
  designed = 글자까지 이미지 안에 그려 넣는 완성형 디자인. 말풍선 대사, 손글씨 메모, 포스터 제목처럼 글자가 그림의 일부인 형식은 반드시 이것.
             그릴 글자는 image_text 에 정확히 (짧게, 한 장에 1~4줄). title/body 는 비워.
  photo    = 이미지만 (글자 없음)
  overlay  = 서버가 이미지 아래쪽에 깔끔한 제목·문장을 얹음
  panel    = 위 이미지 + 아래 글 영역 (설명이 긴 정보형)
  center   = 이미지 위 가운데 큰 문장 (인용·강조)
  웹툰·손글씨 메모·포스터·인터뷰 형식이면 designed 를, 깔끔한 정보 정리형이면 overlay/panel/center 를 주로 써.
- 글의 말투는 주제·컨셉과 연출 방향에서 드러나는 느낌을 따라.
- title 20자, body 80자, image_text 는 줄당 16자 이내로 짧게. cta 는 꼭 필요할 때만(12자), 아니면 빈 문자열.
- visual: 이미지 AI 에게 줄 영어 지시 2~4문장. 이 장의 장면·등장인물·소품·구도·연출을 art_style 로 구체적으로.
  designed 면 글자가 어디에 어떤 모양으로 들어가는지(말풍선 위치, 손글씨 위치, 화살표가 가리키는 대상 등)도 적어.
  그 외 레이아웃이면 글자를 넣지 말라고 적고, overlay 는 아래쪽·center 는 가운데를 단순하게 비워 두라고 적어.

언어 규칙 (매우 중요)
- 게시물에 들어가는 모든 글(캡션, 해시태그, title/body/cta, image_text)은 사용자가 [주제]와 [연출 방향]을 쓴 언어로 써.
  사용자가 언어를 따로 지정했으면(예: '영어로', 'in Japanese', '日本語で') 그 언어로. 두 언어가 섞여 애매하면 {ui_lang}.
- requirements 의 requirement·how 와 concept 는 사용자가 검수 화면에서 읽는 설명이므로 {ui_lang} 로 써.
- visual, art_style 은 이미지 AI 용이라 항상 영어로.
- 해시태그도 게시물 언어로 쓰고, 필요하면 영어 해시태그를 몇 개 섞어도 돼.

캡션 규칙 (매우 중요)
- 캡션은 새로 작문해: 먼저 첨부 사진에 실제로 보이는 것(장소·사람·음식·물건·날씨·분위기·색감)을 살펴보고,
  [주제] 메모의 의도와 [연출 방향]·캡션 양식(컨셉)을 엮어 그 사진에 어울리는 글로. 첫 줄은 사진의 핵심 장면이나 감정으로 시작해.
  사진에 보이지 않고 메모·조사 자료에도 없는 사실(장소 이름·가격·날짜 등)은 지어내지 마.
- 캡션의 말투·표현·강조점도 [주제]와 [연출 방향]을 따라. 조사 자료는 사실을 뒷받침할 때만 써.
- 개인 일상·여행 기록처럼 사적인 게시물이면 친구에게 말하듯 자연스럽고 짧게 써. 요청하지 않았으면 홍보·저장·공유 유도 문구는 쓰지 마.
- 해시태그는 caption_parts 에 넣지 말고 hashtags 배열(# 없이 8~15개, 주제·장소·분위기에 맞게)로. 항상 만들어.
{caption_rules}"""


_ORIGINAL_RULES = """

원본 게시 (매우 중요)
- 첨부는 사용자가 올린 원본이고 이미지 편집 없이 그대로, 올린 순서대로 게시돼: {kinds}
- 그러니 slides 는 첨부 순서대로 한 장씩(photos 에 그 번호 하나, layout 'photo', 글 없음)만 만들고,
  캡션·해시태그는 동영상 장면(대표 화면)과 사진 내용을 보고 만들어."""


LAYOUTS = ("designed", "photo", "overlay", "panel", "center")


STORY_RULES = """

스토리로 올림 (매우 중요 — 위 슬라이드 규칙보다 우선)
- 피드 게시물이 아니라 인스타그램 스토리야. slides 의 각 장이 따로따로 올라가는 세로 9:16 전체 화면 스토리 한 개씩이야.
- 장 수는 1~{max_stories}장. 사용자가 정한 수가 있으면 그대로.
- 글은 한 장에 아주 짧게(제목 1~2줄), 크고 굵게. 위쪽 13%와 아래쪽 17%는 프로필·답장창에 가려지니 글·얼굴을 두지 마.
- 스토리에는 캡션·해시태그가 붙지 않아. caption_parts 는 빈 문자열 1개, hashtags 는 빈 배열로.
- 첫 장은 넘기고 싶게 만드는 장면으로, 마지막 장은 마무리(정리·한 줄 메시지)로."""


def plan_schema(k: int) -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {
            "requirements": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {"requirement": {"type": "STRING"}, "how": {"type": "STRING"}},
                    "required": ["requirement", "how"],
                },
            },
            "concept": {"type": "STRING"},
            "format": {"type": "STRING"},
            "art_style": {"type": "STRING"},
            "font": {"type": "STRING", "enum": list(FONTS)},
            "slides": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "photos": {"type": "ARRAY", "items": {"type": "INTEGER"}},
                        "layout": {"type": "STRING", "enum": list(LAYOUTS)},
                        "title": {"type": "STRING"},
                        "body": {"type": "STRING"},
                        "cta": {"type": "STRING"},
                        "image_text": {"type": "STRING"},
                        "visual": {"type": "STRING"},
                    },
                    "required": ["photos", "layout", "title", "body", "cta", "image_text", "visual"],
                },
            },
            "caption_parts": {"type": "ARRAY", "items": {"type": "STRING"}, "minItems": k, "maxItems": k},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["requirements", "concept", "format", "art_style", "font", "slides", "caption_parts", "hashtags"],
    }


def plan_post(
    photos: list[bytes],
    *,
    prompt: str,
    style: str,
    caption_format: str,
    notes: str = "",
    research_notes: str = "",
    references: list[bytes] | None = None,
    language: str = "ko",
    original: bool = False,
    kinds: list[str] | None = None,
    story: bool = False,
) -> tuple[dict[str, Any], str, str]:
    """(설계안, 사용 엔진, 경고) — Gemini 실패 시 기본 설계안. references 는 연출 참고 이미지.
    language 는 사용자 화면 언어: 검수용 설명(requirements·concept)을 이 언어로, 게시물 글은 [주제]의 언어로.
    story 면 세로 9:16 스토리 여러 개로 (장마다 따로 올라감, 캡션 없음)."""
    n = len(photos)
    references = references or []
    template = caption_format.strip()
    names = [p for p in placeholders(template) if "해시태그" not in p and "hashtag" not in p.lower()]
    if names:
        caption_rules = TEMPLATE_RULES.format(k=len(names), names=", ".join(f"[{x}]" for x in names), template=template)
    elif template:
        caption_rules = INSTRUCTION_RULES.format(request=template)
    else:
        caption_rules = FREE_RULES
    text = _PLAN_PROMPT.format(
        n=n,
        prompt=prompt,
        notes=notes.strip() or "없음",
        style=style.strip() or "(없음 — 컨셉에 맞게 네가 판단)",
        research=research_notes.strip() or "(조사 자료 없음)",
        max_slides=MAX_SLIDES,
        caption_rules=caption_rules,
        ui_lang=LANG_NAME.get(language, "English"),
        fonts=" / ".join(f"{k}({v['label']})" for k, v in FONTS.items()),
        refs=(
            f"\n(사진 뒤에 첨부한 마지막 {len(references)}장은 사진이 아니라 1순위의 [참고 이미지] 양식 템플릿이야. 사진 번호로 쓰지 마.)"
            if references
            else ""
        ),
        ref_rule=(
            f"\n[참고 이미지 · 양식 템플릿] 첨부 마지막 {len(references)}장 — 이미지를 만들 때 가장 우선하는 기준이야. "
            "모든 장을 이 양식과 똑같이 만들어: 레이아웃·구도, 제목/글자/말풍선/라벨이 놓이는 위치와 방식, 그림체·사진 톤, 색 구성, "
            "글씨 느낌, 장식·테두리·여백. 내용만 이 게시물 주제에 맞게 바꿔 적절히 배치해. "
            "참고 이미지 안에 글자가 들어간 디자인이면 해당 장은 layout 을 designed 로 하고, visual 에 참고 이미지의 어느 위치에 어떤 글이 들어가는지 그대로 적어."
            if references
            else ""
        ),
    )
    if story:
        text += STORY_RULES.format(max_stories=MAX_STORIES)
    if original:
        text += _ORIGINAL_RULES.format(kinds=", ".join(f"{i}번={'동영상(대표 화면)' if k == 'video' else '사진'}" for i, k in enumerate(kinds or [])))
    parts: list[dict[str, Any]] = [{"text": text}]
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64(small(photo))}})
    for ref in references:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64(small(ref, 512))}})
    if not settings.gemini_api_key:
        # Gemini 를 쓰지 않는 환경에서만 기본 구성. 키가 있는데 실패하면 엉뚱한 결과 대신 오류를 냅니다.
        design, engine, warning = fallback_plan(n, prompt, style), "template", "GEMINI_API_KEY 가 없어 기본 구성을 사용했습니다."
        raw = {"caption_parts": []}
    else:
        schema = plan_schema(max(1, len(names)))
        cfg = {"temperature": 0.7, "responseMimeType": "application/json", "responseSchema": schema}
        try:
            raw = json.loads(gemini.text_of(gemini.text_call(parts, cfg)))
            design = sanitize_plan(raw, n)
        except (ValueError, KeyError, TypeError) as exc:
            raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
        engine, warning = "gemini", ""

    # 캡션은 서버가 양식에 맞춰 조립합니다 (섹션 순서·빈 줄·고정 문구를 모델에 맡기지 않음).
    if placeholders(template):
        body_parts = [str(p) for p in (raw.get("caption_parts") or [])]
        full_parts, j = [], 0
        for name in placeholders(template):
            if "해시태그" in name or "hashtag" in name.lower():
                full_parts.append("")
            else:
                full_parts.append(body_parts[j] if j < len(body_parts) else "")
                j += 1
        caption, tags_inline = fill_template(template, full_parts, design["hashtags"])
    else:
        # 지시·자유 모드: Gemini 가 쓴 캡션 그대로 (지시문 자체를 캡션으로 쓰지 않음)
        caption, tags_inline = "\n".join(str(p) for p in raw.get("caption_parts") or []).strip(), False
    if story:  # 스토리는 캡션·해시태그를 붙일 수 없음 (API)
        caption, tags_inline, design["hashtags"] = "", False, []
        design["slides"] = design["slides"][:MAX_STORIES]
    design["caption"] = caption[:2200]
    design["hashtags_inline"] = tags_inline
    design["caption_format"] = template
    return design, engine, warning


def sanitize_plan(raw: dict[str, Any], n: int) -> dict[str, Any]:
    """사진 번호·레이아웃·길이를 보정합니다. 컨셉에 맞지 않는 사진은 쓰지 않아도 됩니다 (-1 = 새 이미지 생성)."""

    def slide(s: dict[str, Any]) -> dict[str, Any]:
        raw_photos = s.get("photos")
        if raw_photos is None and isinstance(s.get("photo"), int):  # 모델이 예전 형식(photo 하나)으로 답한 경우
            raw_photos = [s["photo"]]
        photos = []
        for x in raw_photos or []:
            if isinstance(x, int) and 0 <= x < n and x not in photos:
                photos.append(x)
        photos = photos[:4]
        layout = s.get("layout") if s.get("layout") in LAYOUTS else "overlay"
        title, body = clip(s.get("title"), 26), clip(s.get("body"), 100)
        image_text = clip(s.get("image_text"), 160)
        if layout in ("overlay", "panel", "center") and not (title or body):
            layout = "photo"  # 서버가 얹을 글이 없으면 이미지만
        server_text = layout in ("overlay", "panel", "center")
        return {
            "photos": photos,
            "layout": layout,
            "title": title if server_text else "",
            "body": body if server_text else "",
            "cta": clip(s.get("cta"), 16) if layout in ("overlay", "center") else "",
            "image_text": image_text if layout == "designed" else "",
            "visual": clip(s.get("visual"), 700),
        }

    slides = [slide(s) for s in (raw.get("slides") or []) if isinstance(s, dict)][:MAX_SLIDES]
    if not slides:
        slides = fallback_plan(n, "")["slides"]
    return {
        "requirements": [
            {"requirement": clip(r.get("requirement"), 200), "how": clip(r.get("how"), 300)}
            for r in (raw.get("requirements") or [])
            if isinstance(r, dict) and r.get("requirement")
        ][:20],
        "concept": clip(raw.get("concept"), 200),
        "format": clip(raw.get("format"), 60),
        "art_style": clip(raw.get("art_style"), 400),
        "font": font_key(raw.get("font")),
        "slides": slides,
        "hashtags": [str(t).lstrip("#").strip() for t in (raw.get("hashtags") or []) if str(t).strip()][:20],
    }


_ONE_SLIDE = re.compile(r"(한|1)\s*장\s*(짜리|으로|만|에)|하나로\s*합|한\s*장의|단일\s*(이미지|게시물)")


def fallback_plan(n: int, prompt: str, style: str = "") -> dict[str, Any]:
    """Gemini 없이: 올린 사진을 순서대로 쓰고, 첫 장에만 주제를 얹습니다 (고정 문구 없음).
    '한 장 짜리'처럼 한 장을 원하면 사진을 모두 한 장에 합칩니다."""
    topic = clip(prompt.splitlines()[0] if prompt else "", 26)
    blank = {"layout": "photo", "title": "", "body": "", "cta": "", "image_text": "", "visual": ""}
    if n == 0:
        return {"concept": topic, "slides": [{**blank, "photos": [], "layout": "center" if topic else "photo", "title": topic}], "hashtags": []}
    if n > 1 and _ONE_SLIDE.search(f"{prompt}\n{style}"):
        ids = list(range(min(n, 4)))
        return {"concept": topic, "slides": [{**blank, "photos": ids}], "hashtags": []}
    slides = [{**blank, "photos": [i]} for i in range(min(n, MAX_SLIDES))]
    if topic:
        slides[0].update(layout="overlay", title=topic)
    return {"concept": topic, "slides": slides, "hashtags": []}


def slide_list(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """렌더링 순서. role 은 레이아웃.
    카드뉴스 전용이던 때(표지·내용·결론 고정) 만든 작업은 cover/content/conclusion 구조라 그것도 읽습니다."""
    if "cover" in plan:
        legacy = (
            [{"role": "overlay", **plan["cover"], "body": plan["cover"].get("subtitle", "")}]
            + [{"role": "panel", **s, "title": s.get("heading", "")} for s in plan.get("slides", [])]
            + [{"role": "center", **plan["conclusion"]}]
        )
        return legacy
    # 직접 만든 작업(사진 그대로)은 layout 없이 role 만 있음
    return [{"role": s.get("layout") or s.get("role") or "photo", **s} for s in plan["slides"]]
