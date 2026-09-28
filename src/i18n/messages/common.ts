import { defineMessages } from "../define";

/** 여러 화면에서 함께 쓰는 문구 */
export default defineMessages({
  ko: {
    close: "닫기", cancel: "취소", save: "저장", saved: "저장됨 ✓", delete: "삭제", edit: "수정", refresh: "새로고침",
    loading: "불러오는 중…", checking: "확인 중…", retry: "다시 시도", on: "켜짐", off: "꺼짐", viewAll: "전체 보기 →",
    noData: "데이터가 없습니다.", noChartData: "표시할 데이터가 없습니다.", noCompare: "비교 데이터 없음", vsPrev: "직전 기간 대비",
    dailyTrend: "{names} 일자별 추이",
    connectInstagram: "Instagram 계정 연결하기", privacy: "개인정보처리방침", dataDeletion: "데이터 삭제 안내",
    language: "언어",
    requestFailed: "요청에 실패했습니다 ({status})",
    serverUnreachable: "서버에 연결할 수 없습니다. 백엔드(npm run dev:api)가 실행 중인지 확인하세요.",
    metaTitle: "Instagram Auto Studio",
    metaDescription: "사진과 주제로 Instagram 게시물을 만들어 게시하고, 댓글에 자동으로 답하고, 성과를 한눈에 봅니다.",
  },
  en: {
    close: "Close", cancel: "Cancel", save: "Save", saved: "Saved ✓", delete: "Delete", edit: "Edit", refresh: "Refresh",
    loading: "Loading…", checking: "Checking…", retry: "Try again", on: "On", off: "Off", viewAll: "View all →",
    noData: "No data.", noChartData: "Nothing to show yet.", noCompare: "No comparison data", vsPrev: "vs. previous period",
    dailyTrend: "Daily trend of {names}",
    connectInstagram: "Connect Instagram account", privacy: "Privacy Policy", dataDeletion: "Data Deletion",
    language: "Language",
    requestFailed: "Request failed ({status})",
    serverUnreachable: "Can't reach the server. Make sure the backend (npm run dev:api) is running.",
    metaTitle: "Instagram Auto Studio",
    metaDescription: "Create Instagram posts from your photos and topic, publish them, auto-reply to comments and see performance at a glance.",
  },
  ja: {
    close: "閉じる", cancel: "キャンセル", save: "保存", saved: "保存しました ✓", delete: "削除", edit: "編集", refresh: "更新",
    loading: "読み込み中…", checking: "確認中…", retry: "再試行", on: "オン", off: "オフ", viewAll: "すべて見る →",
    noData: "データがありません。", noChartData: "表示できるデータがありません。", noCompare: "比較データなし", vsPrev: "前の期間比",
    dailyTrend: "{names}の日別推移",
    connectInstagram: "Instagramアカウントを連携", privacy: "プライバシーポリシー", dataDeletion: "データ削除について",
    language: "言語",
    requestFailed: "リクエストに失敗しました ({status})",
    serverUnreachable: "サーバーに接続できません。バックエンド(npm run dev:api)が起動しているか確認してください。",
    metaTitle: "Instagram Auto Studio",
    metaDescription: "写真とテーマからInstagram投稿を作成・投稿し、コメントに自動返信し、成果をひと目で確認できます。",
  },
});
