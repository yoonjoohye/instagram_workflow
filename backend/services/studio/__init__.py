"""게시물 만들기 (사진과 주제로 Instagram 게시물을 만드는 기능).

흐름 — API 는 backend/routers/studio.py
  1) research.research      주제 조사 (Gemini + Google 검색, 정보형 주제일 때 출처 보관)
     research.photo_query   기기 사진 자동 선택용 검색 조건 (사진 자체는 서버로 오지 않음)
  2) planning.plan_post     장 수·장별 사진·레이아웃·글·연출 지시 + 캡션·해시태그·음악을 설계
                            캡션은 양식의 [칸]별로 받아 captions.fill_template 가 조립
  3) visuals.render_visual  Gemini 이미지 모델로 연출대로 다시 만들거나 새로 생성 (실패 시 imaging 의 보정·콜라주)
  4) compose.compose        레이아웃대로 서버가 글자를 얹음 (AI 이미지 모델은 한글을 자주 깨뜨림)

Gemini 호출·재시도는 모두 gemini.py 를 거칩니다 (테스트에서는 gemini.call 을 가짜로 바꿉니다).
"""
from .compose import ACCENT, compose
from .fonts import DEFAULT_FONT, FONTS, font_key, font_label, font_preview
from .gemini import GeminiError, is_busy
from .imaging import cover_fit, image_size, normalize, to_jpeg
from .limits import MAX_PHOTOS, MAX_SLIDES, SIZE
from .music import suggest_music
from .planning import plan_post, slide_list
from .research import photo_query, research
from .visuals import ASPECT, edit_visual, render_visual

__all__ = [
    "ACCENT", "ASPECT", "DEFAULT_FONT", "FONTS", "MAX_PHOTOS", "MAX_SLIDES", "SIZE", "GeminiError",
    "compose", "cover_fit", "edit_visual", "font_key", "font_label", "font_preview", "image_size", "is_busy",
    "normalize", "photo_query", "plan_post", "render_visual", "research", "slide_list", "suggest_music", "to_jpeg",
]
