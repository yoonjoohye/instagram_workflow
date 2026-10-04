import { defineMessages } from "../define";

/** 만들기 템플릿: 한 번 눌러 연출 방향(style)과 캡션 양식(format)을 채웁니다.
 *  format 의 [ ] 밖 글자는 캡션에 그대로 들어가므로 언어마다 따로 씁니다. 비우면 Gemini 가 자유롭게. */
export default defineMessages({
  ko: {
    auto: "자동", autoDesc: "주제만 보고 Gemini가 형식을 정해요",
    travel: "여행 기록", travelDesc: "필름 감성, 글자 최소", travelStyle: "여행지 감성 기록. 사진 원본의 색감을 살린 필름 카메라 느낌으로 살짝 보정하고, 이미지 속 글자는 넣지 마. 여러 장이면 장소마다 한 장씩.", travelFormat: "",
    daily: "일상 사진", dailyDesc: "사진 그대로, 짧은 캡션", dailyStyle: "자연스러운 일상 기록. 사진은 거의 그대로 두고 밝기·색감만 살짝 보정, 이미지 속 글자 없이.", dailyFormat: "",
    info: "정보 카드뉴스", infoDesc: "후킹 표지 + 핵심 정리", infoStyle: "정보 정리형 카드뉴스 5~7장. 1장은 어두운 배경에 크고 굵은 후킹 제목, 2장부터 핵심 정보를 한 장에 하나씩 짧게, 마지막 장은 한눈에 보는 요약. 깔끔한 고딕 글씨.", infoFormat: "[후킹 2줄]\n\n[핵심 정보 3~5줄, 줄마다 이모지로 시작]\n\n[저장을 유도하는 마무리 한 줄]",
    toon: "인스타툰", toonDesc: "캐릭터 말풍선 4컷", toonStyle: "인스타툰 웹툰 4컷 형식. 귀여운 캐릭터가 말풍선으로 이야기하고, 파스텔 톤, 손글씨 느낌 글씨.", toonFormat: "[한 줄 요약]\n\n[공감 가는 뒷이야기 2~3줄]",
    product: "제품 홍보", productDesc: "제품이 돋보이는 광고", productStyle: "제품이 돋보이는 깔끔한 광고 이미지. 밝은 단색 배경에 제품을 가운데 크게, 굵은 제목 한 줄과 핵심 장점만.", productFormat: "[후킹 한 줄]\n\n[제품 장점 3개, 줄마다 ✔️로 시작]\n\n[구매·문의 안내 한 줄]",
    event: "이벤트 공지", eventDesc: "기간·혜택·참여 방법", eventStyle: "눈에 띄는 이벤트 포스터 한 장. 굵은 제목과 기간·혜택·참여 방법이 한눈에 보이게.", eventFormat: "[이벤트 제목 한 줄]\n\n📅 [기간]\n🎁 [혜택]\n✅ [참여 방법]\n\n[참여를 유도하는 한 줄]",
    food: "맛집 후기", foodDesc: "음식 클로즈업 + 후기", foodStyle: "음식이 맛있어 보이게 따뜻한 색감으로 보정. 첫 장은 대표 메뉴 클로즈업, 이미지 속 글자는 메뉴 이름만 작게.", foodFormat: "[첫인상 한 줄]\n\n[메뉴와 맛 후기 2~3줄]\n📍 [가게 이름·위치]",
  },
  en: {
    auto: "Auto", autoDesc: "Gemini picks a format from your topic",
    travel: "Travel diary", travelDesc: "Film look, minimal text", travelStyle: "Travel memories. Lightly edit with a film-camera look that keeps the original colors, and no text in the images. With several photos, one per place.", travelFormat: "",
    daily: "Everyday", dailyDesc: "Photos as they are, short caption", dailyStyle: "Natural everyday moments. Keep the photos almost as they are with a light brightness/color touch-up, no text in the images.", dailyFormat: "",
    info: "Info carousel", infoDesc: "Hook cover + key points", infoStyle: "Informative carousel of 5–7 slides. Slide 1: big bold hook headline on a dark background. From slide 2: one key point per slide, short. Last slide: a quick summary. Clean sans-serif type.", infoFormat: "[2-line hook]\n\n[3–5 key points, each line starting with an emoji]\n\n[one closing line encouraging saves]",
    toon: "Comic strip", toonDesc: "4-panel character comic", toonStyle: "4-panel Instagram comic. A cute character tells the story in speech bubbles, pastel tones, handwritten-style lettering.", toonFormat: "[one-line summary]\n\n[2–3 relatable lines of backstory]",
    product: "Product promo", productDesc: "Ad that makes the product shine", productStyle: "Clean ad image that makes the product shine. Product large and centered on a bright solid background, one bold headline and the key benefits only.", productFormat: "[one-line hook]\n\n[3 product benefits, each line starting with ✔️]\n\n[one line on how to buy or contact]",
    event: "Event notice", eventDesc: "Dates, perks, how to join", eventStyle: "One eye-catching event poster. Bold title, with dates, perks and how to join visible at a glance.", eventFormat: "[event title]\n\n📅 [dates]\n🎁 [perks]\n✅ [how to join]\n\n[one line encouraging people to join]",
    food: "Food review", foodDesc: "Close-ups + review", foodStyle: "Warm color edit that makes the food look delicious. First slide: close-up of the signature dish; only small menu names as text in the images.", foodFormat: "[one-line first impression]\n\n[2–3 lines on the dishes and taste]\n📍 [restaurant name and location]",
  },
  ja: {
    auto: "自動", autoDesc: "テーマからGeminiが形式を決めます",
    travel: "旅の記録", travelDesc: "フィルム風、文字は最小限", travelStyle: "旅の思い出の記録。写真の元の色味を活かしたフィルムカメラ風に軽く補正し、画像内に文字は入れない。複数枚なら場所ごとに1枚ずつ。", travelFormat: "",
    daily: "日常", dailyDesc: "写真はそのまま、短いキャプション", dailyStyle: "自然な日常の記録。写真はほぼそのままで明るさ・色味だけ軽く補正し、画像内に文字は入れない。", dailyFormat: "",
    info: "情報まとめ", infoDesc: "フック表紙 + 要点整理", infoStyle: "情報まとめのカルーセル5〜7枚。1枚目は暗い背景に大きく太いフックの見出し、2枚目からは要点を1枚に1つずつ短く、最後は一目でわかるまとめ。すっきりしたゴシック体。", infoFormat: "[フック2行]\n\n[要点3〜5行、各行を絵文字で始める]\n\n[保存を促す締めの一行]",
    toon: "インスタ漫画", toonDesc: "キャラの吹き出し4コマ", toonStyle: "インスタ漫画の4コマ形式。かわいいキャラクターが吹き出しで話し、パステルトーン、手書き風の文字。", toonFormat: "[一行まとめ]\n\n[共感できる裏話2〜3行]",
    product: "商品PR", productDesc: "商品が映える広告", productStyle: "商品が映えるすっきりした広告画像。明るい単色背景に商品を中央に大きく、太い見出し1行と主なメリットだけ。", productFormat: "[フック一行]\n\n[商品のメリット3つ、各行を✔️で始める]\n\n[購入・問い合わせ案内の一行]",
    event: "イベント告知", eventDesc: "期間・特典・参加方法", eventStyle: "目を引くイベントポスター1枚。太いタイトルと期間・特典・参加方法が一目でわかるように。", eventFormat: "[イベントタイトル]\n\n📅 [期間]\n🎁 [特典]\n✅ [参加方法]\n\n[参加を促す一行]",
    food: "グルメレビュー", foodDesc: "料理のアップ + 感想", foodStyle: "料理がおいしそうに見える暖かい色味に補正。1枚目は看板メニューのアップ、画像内の文字はメニュー名だけ小さく。", foodFormat: "[第一印象の一行]\n\n[メニューと味の感想2〜3行]\n📍 [店名・場所]",
  },
});
