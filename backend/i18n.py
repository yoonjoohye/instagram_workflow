"""API 응답 문구 다국어 처리 (ko · en · ja).

서버 코드는 한국어로 메시지를 만들고, 응답 직전에 요청 언어로 바꿉니다.
  - 언어: 'lang' 쿠키(화면에서 고른 언어) → Accept-Language → en
  - CATALOG 의 한국어 문장을 틀로 써서 {x} 자리는 그대로 옮기고, 그 안의 문장도 다시 번역합니다.
    (예: "이미지를 수정하지 못했습니다. {hint}" 의 hint 도 번역)
  - 목록에 없는 문장(Meta·Gemini 가 준 영어 오류 등)은 그대로 둡니다.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from starlette.requests import HTTPConnection

LANGS = ("ko", "en", "ja")
DEFAULT_LANG = "en"
LANG_NAME = {"ko": "Korean (한국어)", "en": "English", "ja": "Japanese (日本語)"}


def lang_of(request: HTTPConnection | None) -> str:
    if request is None:
        return DEFAULT_LANG
    saved = request.cookies.get("lang")
    if saved in LANGS:
        return saved
    for part in (request.headers.get("accept-language") or "").split(","):
        base = part.split(";")[0].strip().lower().split("-")[0]
        if base in LANGS:
            return base
    return DEFAULT_LANG


def norm_lang(value: str | None) -> str:
    return value if value in LANGS else DEFAULT_LANG


# 한국어 틀 → (English, 日本語). {이름} 자리는 순서와 관계없이 같은 이름으로 옮깁니다.
CATALOG: dict[str, tuple[str, str]] = {
    # 로그인·세션
    "로그인이 필요합니다.": ("Please log in.", "ログインが必要です。"),
    "세션이 만료됐습니다. 다시 로그인하세요.": ("Your session has expired. Please log in again.", "セッションの有効期限が切れました。もう一度ログインしてください。"),
    "계정을 찾을 수 없습니다.": ("Account not found.", "アカウントが見つかりません。"),
    "저장된 토큰을 복호화할 수 없습니다. 다시 로그인하세요.": ("The stored token couldn't be decrypted. Please log in again.", "保存されたトークンを復号できません。もう一度ログインしてください。"),
    "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (또는 META_APP_ID / META_APP_SECRET) 이 설정되지 않았습니다. 환경변수를 확인하세요.": (
        "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (or META_APP_ID / META_APP_SECRET) is not set. Check your environment variables.",
        "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET(または META_APP_ID / META_APP_SECRET)が設定されていません。環境変数を確認してください。",
    ),
    "권한 허용을 취소했습니다. 다시 연결해 주세요.": ("You cancelled the permission request. Please connect again.", "権限の許可がキャンセルされました。もう一度連携してください。"),
    "OAuth state 검증에 실패했습니다. 다시 시도해 주세요.": ("OAuth state verification failed. Please try again.", "OAuth state の検証に失敗しました。もう一度お試しください。"),
    "Instagram 프로페셔널 계정이 연결된 Facebook 페이지를 찾지 못했습니다. Instagram 앱에서 비즈니스/크리에이터 계정으로 전환하고 페이지에 연결해 주세요.": (
        "No Facebook Page linked to an Instagram professional account was found. Switch to a Business/Creator account in the Instagram app and link it to a Page.",
        "Instagramプロアカウントに連携されたFacebookページが見つかりません。Instagramアプリでビジネス/クリエイターアカウントに切り替え、ページと連携してください。",
    ),
    "이 브라우저에서 연결한 계정만 전환할 수 있습니다.": ("You can only switch to accounts connected in this browser.", "このブラウザで連携したアカウントにのみ切り替えられます。"),
    "로그인 코드가 만료됐습니다. 다시 로그인해 주세요.": ("The login code expired. Please log in again.", "ログインコードの有効期限が切れました。もう一度ログインしてください。"),
    "signed_request 검증 실패": ("signed_request verification failed", "signed_request の検証に失敗しました"),
    "해당 확인 코드를 찾을 수 없습니다.": ("That confirmation code wasn't found.", "該当する確認コードが見つかりません。"),
    "인증 실패": ("Authentication failed", "認証に失敗しました"),
    "토큰 갱신 실패: {e}": ("Token refresh failed: {e}", "トークンの更新に失敗しました: {e}"),
    # Webhook
    "인증 토큰이 일치하지 않습니다.": ("The verify token doesn't match.", "認証トークンが一致しません。"),
    "서명이 올바르지 않습니다.": ("Invalid signature.", "署名が正しくありません。"),
    # 업로드·게시물 만들기
    "사진이 너무 큽니다 (최대 8MB).": ("The photo is too large (max 8MB).", "写真が大きすぎます(最大8MB)。"),
    "이미지 파일을 읽을 수 없습니다.": ("Couldn't read the image file.", "画像ファイルを読み込めません。"),
    "이미지를 찾을 수 없습니다.": ("Image not found.", "画像が見つかりません。"),
    "업로드한 사진을 찾을 수 없습니다.": ("Uploaded photo not found.", "アップロードした写真が見つかりません。"),
    "게시물 작업을 찾을 수 없습니다.": ("Post job not found.", "投稿の作業が見つかりません。"),
    "없는 글씨체입니다.": ("Unknown font.", "存在しないフォントです。"),
    "Gemini 가 지금 혼잡하거나 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요. ({e})": (
        "Gemini is busy or has hit its usage limit right now. Please try again in a moment. ({e})",
        "Geminiが混雑しているか、利用上限に達しています。しばらくしてからもう一度お試しください。({e})",
    ),
    "사진 검색 조건을 만들지 못했습니다: {e}": ("Couldn't build the photo search: {e}", "写真の検索条件を作成できませんでした: {e}"),
    "음악을 추천하지 못했습니다: {e}": ("Couldn't suggest music: {e}", "音楽をおすすめできませんでした: {e}"),
    "결과 없음": ("no results", "結果なし"),
    "동영상 주소가 올바르지 않습니다.": ("Invalid video URL.", "動画のURLが正しくありません。"),
    "원본 그대로 게시하는 작업은 이미지를 다시 만들 수 없습니다.": ("Images can't be recreated for a post published as originals.", "元のまま投稿する作業では画像を作り直せません。"),
    "Gemini 로 게시물을 구성하지 못했습니다: {e}": ("Gemini couldn't plan the post: {e}", "Geminiで投稿を構成できませんでした: {e}"),
    "이미 게시된 작업입니다.": ("This job has already been published.", "この作業はすでに投稿済みです。"),
    "이미지 번호가 올바르지 않습니다.": ("Invalid image number.", "画像番号が正しくありません。"),
    "무엇을 고칠지 적어 주세요.": ("Describe what to change.", "何を修正するか入力してください。"),
    "고칠 이미지를 찾지 못했습니다. '처음부터 다시'로 만들어 주세요.": ("Couldn't find the image to edit. Use 'Start over' instead.", "修正する画像が見つかりません。「最初から作り直す」で作成してください。"),
    "고칠 이미지를 찾지 못했습니다.": ("Couldn't find the image to edit.", "修正する画像が見つかりません。"),
    "이미지를 수정하지 못했습니다. {hint}": ("Couldn't edit the image. {hint}", "画像を修正できませんでした。{hint}"),
    "아직 만들지 않은 이미지가 있습니다: {ids}": ("Some images haven't been created yet: {ids}", "まだ作成していない画像があります: {ids}"),
    "Gemini 이미지 모델 사용 한도가 없습니다 (무료 등급은 이미지 생성 한도가 0). Google AI Studio 에서 결제를 설정해 유료 등급으로 바꿔야 이미지 연출·생성·수정이 동작합니다.": (
        "The Gemini image model has no quota (the free tier allows 0 image generations). Set up billing in Google AI Studio to switch to a paid tier so image styling, generation and editing work.",
        "Gemini画像モデルの利用枠がありません(無料枠では画像生成が0回)。Google AI Studioで支払いを設定して有料枠に切り替えると、画像の演出・生成・修正が動作します。",
    ),
    # (예전 작업에 저장된 문구)
    "Gemini 이미지 모델 사용 한도가 없습니다 (무료 등급은 이미지 생성 한도가 0). Google AI Studio 에서 결제를 설정해 유료 등급으로 바꿔야 이미지 연출·생성이 동작합니다.": (
        "The Gemini image model has no quota (the free tier allows 0 image generations). Set up billing in Google AI Studio to switch to a paid tier so image styling and generation work.",
        "Gemini画像モデルの利用枠がありません(無料枠では画像生成が0回)。Google AI Studioで支払いを設定して有料枠に切り替えると、画像の演出・生成が動作します。",
    ),
    "설정한 Gemini 이미지 모델을 쓸 수 없습니다. GEMINI_IMAGE_MODEL 을 확인하세요.": (
        "The configured Gemini image model isn't available. Check GEMINI_IMAGE_MODEL.",
        "設定したGemini画像モデルを利用できません。GEMINI_IMAGE_MODEL を確認してください。",
    ),
    "원인: {e}": ("Cause: {e}", "原因: {e}"),
    "{failed}/{total}장은 이미지 생성에 실패해 원본 사진 보정(또는 빈 배경)으로 대신 만들었습니다. {hint}": (
        "{failed}/{total} image(s) couldn't be generated, so an enhanced original photo (or a plain background) was used instead. {hint}",
        "{failed}/{total}枚は画像生成に失敗したため、元写真の補正(または無地の背景)で代わりに作成しました。{hint}",
    ),
    "주제 조사(검색) 실패로 사진·입력 정보만 사용: {e}": ("Topic research (search) failed, so only your photos and input were used: {e}", "テーマ調査(検索)に失敗したため、写真と入力情報のみを使用しました: {e}"),
    "GEMINI_API_KEY 가 없어 기본 구성을 사용했습니다.": ("GEMINI_API_KEY isn't set, so a basic layout was used.", "GEMINI_API_KEY が未設定のため、基本構成を使用しました。"),
    "GEMINI_API_KEY 가 설정되지 않았습니다.": ("GEMINI_API_KEY is not set.", "GEMINI_API_KEY が設定されていません。"),
    "Gemini 연결 실패: {e}": ("Couldn't connect to Gemini: {e}", "Geminiに接続できません: {e}"),
    "Gemini 오류 ({e})": ("Gemini error ({e})", "Geminiエラー({e})"),
    "Gemini 시간 초과": ("Gemini timed out", "Geminiがタイムアウトしました"),
    "Gemini 응답 없음: {e}": ("No response from Gemini: {e}", "Geminiから応答がありません: {e}"),
    "응답이 비어 있습니다": ("the response was empty", "応答が空です"),
    "Gemini 응답을 읽지 못했습니다: {e}": ("Couldn't read Gemini's response: {e}", "Geminiの応答を読み取れませんでした: {e}"),
    "이미지가 응답에 없습니다.": ("The response contained no image.", "応答に画像が含まれていません。"),
    # 작업·발행
    "작업을 찾을 수 없습니다.": ("Job not found.", "作業が見つかりません。"),
    "이미 발행된 게시물은 수정할 수 없습니다.": ("Published posts can't be edited.", "投稿済みの投稿は編集できません。"),
    "이미 발행된 작업입니다.": ("This job has already been published.", "この作業はすでに投稿済みです。"),
    "발행할 미디어가 없습니다.": ("There's no media to publish.", "投稿するメディアがありません。"),
    "24시간 발행 한도를 모두 썼습니다 ({used}/{total}).": ("You've used your 24-hour publishing limit ({used}/{total}).", "24時間の投稿上限に達しました({used}/{total})。"),
    "캐러셀은 자식 컨테이너가 최소 2개 필요합니다.": ("A carousel needs at least 2 items.", "カルーセルには2つ以上のアイテムが必要です。"),
    "컨테이너 ID 를 받지 못했습니다.": ("No container ID was returned.", "コンテナIDを取得できませんでした。"),
    "미디어 처리 실패 ({code}): {s}": ("Media processing failed ({code}): {s}", "メディアの処理に失敗しました({code}): {s}"),
    "미디어 처리 시간이 초과됐습니다. 잠시 후 '발행 재시도'를 눌러 주세요.": ("Media processing timed out. Please try publishing again in a moment.", "メディアの処理がタイムアウトしました。しばらくしてから投稿を再試行してください。"),
    "발행 후 미디어 ID 를 받지 못했습니다.": ("No media ID was returned after publishing.", "投稿後にメディアIDを取得できませんでした。"),
    "Graph API 응답을 해석할 수 없습니다 ({e})": ("Couldn't parse the Graph API response ({e})", "Graph APIの応答を解析できません({e})"),
    "알 수 없는 Graph API 오류": ("Unknown Graph API error", "不明なGraph APIエラー"),
    "Graph API 오류 ({e})": ("Graph API error ({e})", "Graph APIエラー({e})"),
    # 자동 응답
    "규칙을 찾을 수 없습니다.": ("Rule not found.", "ルールが見つかりません。"),
    "Facebook 로그인 방식은 Meta 앱 대시보드에서 페이지 구독을 설정하세요.": (
        "With Facebook Login, set up the Page subscription in the Meta App Dashboard.",
        "Facebookログインの場合は、Metaアプリダッシュボードでページのサブスクリプションを設定してください。",
    ),
    "답글 실패: {e}": ("Reply failed: {e}", "返信に失敗しました: {e}"),
    "DM 실패: {e}": ("DM failed: {e}", "DMに失敗しました: {e}"),
    "DM 전송 실패: {e}": ("Couldn't send the DM: {e}", "DMの送信に失敗しました: {e}"),
    "팔로우 여부를 확인하지 못했습니다 (instagram_business_manage_messages 권한 확인).": (
        "Couldn't check the follow status (check the instagram_business_manage_messages permission).",
        "フォロー状況を確認できませんでした(instagram_business_manage_messages 権限を確認してください)。",
    ),
    # 대시보드 안내
    "Instagram Graph API 는 프로필을 조회한 '개별 계정'을 제공하지 않습니다. 집계 수치만 제공됩니다. 도달 계정 합계는 기간 내 고유 계정 수라 일자별 도달의 합보다 작을 수 있습니다.": (
        "The Instagram Graph API doesn't provide the individual accounts that viewed your profile — only aggregate numbers. Accounts reached counts unique accounts over the period, so it can be lower than the sum of daily reach.",
        "Instagram Graph APIはプロフィールを見た個別アカウントを提供せず、集計値のみを提供します。リーチしたアカウントの合計は期間内のユニーク数のため、日別リーチの合計より小さくなることがあります。",
    ),
    "팔로워가 100명 미만이면 Meta 가 인구통계를 제공하지 않습니다.": ("Meta doesn't provide demographics for accounts with fewer than 100 followers.", "フォロワーが100人未満の場合、Metaは属性データを提供しません。"),
    "팔로워 100명 미만이거나 해당 기간 도달·반응이 적으면 Meta 가 인구통계를 제공하지 않습니다.": (
        "Meta doesn't provide demographics if you have fewer than 100 followers or little reach/engagement in the period.",
        "フォロワーが100人未満、または期間中のリーチや反応が少ない場合、Metaは属性データを提供しません。",
    ),
    # 댓글 감정 (규칙 기반 분류 사유)
    "긍정 표현/이모지": ("Positive words/emoji", "ポジティブな表現・絵文字"),
    "부정 표현/이모지": ("Negative words/emoji", "ネガティブな表現・絵文字"),
    "뚜렷한 감정 표현 없음": ("No clear sentiment", "はっきりした感情表現なし"),
}


@lru_cache(maxsize=1)
def _patterns() -> list[tuple[re.Pattern[str], str, tuple[str, str]]]:
    out = []
    # 긴 틀부터 (짧은 틀이 긴 문장의 일부를 먼저 가로채지 않게)
    for ko, tr in sorted(CATALOG.items(), key=lambda kv: -len(kv[0])):
        parts = re.split(r"(\{\w+\})", ko)
        regex = "".join(f"(?P<{p[1:-1]}>.+?)" if re.fullmatch(r"\{\w+\}", p) else re.escape(p) for p in parts)
        out.append((re.compile(f"^{regex}$", re.S), ko, tr))
    return out


def tr(text: str, lang: str) -> str:
    """한국어 메시지 → lang. ' / ' 로 이어 붙인 여러 문장도 각각 번역합니다."""
    if lang == "ko" or not isinstance(text, str) or not text:
        return text
    if " / " in text:
        return " / ".join(tr(part, lang) for part in text.split(" / "))
    idx = 0 if lang == "en" else 1
    for pattern, _ko, target in _patterns():
        m = pattern.match(text.strip())
        if m:
            values = {k: tr(v, lang) for k, v in m.groupdict().items()}
            return target[idx].format(**values)
    return text


# 응답 JSON 에서 번역할 필드 (사람이 읽는 문구만)
TRANSLATE_KEYS = {"detail", "note", "warning", "error", "reason", "last_error"}


def translate_payload(data: Any, lang: str) -> Any:
    if lang == "ko":
        return data
    if isinstance(data, dict):
        return {
            k: (tr(v, lang) if k in TRANSLATE_KEYS and isinstance(v, str) else translate_payload(v, lang))
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [translate_payload(v, lang) for v in data]
    return data
