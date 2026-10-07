"""게시물 크기·장 수 한도."""

SIZE = (1080, 1350)  # Instagram 세로 4:5
MAX_PHOTOS = 8  # 업로드 최대 장수
MAX_SLIDES = 10  # Instagram 캐러셀 최대 장수

STORY_SIZE = (1080, 1920)  # 스토리 세로 9:16
MAX_STORIES = 5  # 한 번에 만드는 스토리 수 (각각 따로 올라감)
# 스토리 화면에서 위(프로필·진행 막대)와 아래(답장 입력창)는 가려지므로 글을 두지 않는 영역
STORY_SAFE_TOP = 250
STORY_SAFE_BOTTOM = 330
