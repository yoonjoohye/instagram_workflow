"""사진 편집기 '내 필터': 사용자가 맞춘 보정 값을 이름을 붙여 저장해 두고 다시 씁니다 (회원별, 최대 30개)."""
from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..deps import current_user
from ..models import User

router = APIRouter(tags=["filters"])

MAX_PRESETS = 30
_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}$")


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    values: dict[str, float] = Field(max_length=120)

    @field_validator("values")
    @classmethod
    def _keys(cls, v: dict[str, float]) -> dict[str, float]:
        # 보정 항목 이름과 범위만 (편집기가 알아서 쓰는 값; 엉뚱한 값은 버림)
        return {k: max(-360.0, min(360.0, float(x))) for k, x in v.items() if _KEY.match(k)}


def _list(user: User) -> list[dict]:
    return list(user.filter_presets or [])


@router.get("/studio/filters")
def list_presets(user: User = Depends(current_user)) -> dict:
    return {"data": _list(user)}


@router.post("/studio/filters", status_code=status.HTTP_201_CREATED)
def save_preset(body: PresetIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    presets = _list(user)
    name = body.name.strip()
    same = next((p for p in presets if p.get("name") == name), None)
    if same is not None:  # 같은 이름이면 덮어쓰기
        same["values"] = body.values
        item = same
    else:
        if len(presets) >= MAX_PRESETS:
            raise HTTPException(status.HTTP_409_CONFLICT, f"내 필터는 {MAX_PRESETS}개까지 저장할 수 있습니다. 안 쓰는 필터를 지워 주세요.")
        item = {"id": secrets.token_urlsafe(6), "name": name, "values": body.values}
        presets.append(item)
    user.filter_presets = presets
    flag_modified(user, "filter_presets")
    db.commit()
    return item


@router.delete("/studio/filters/{preset_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_preset(preset_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    presets = _list(user)
    kept = [p for p in presets if p.get("id") != preset_id]
    if len(kept) == len(presets):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "필터를 찾을 수 없습니다.")
    user.filter_presets = kept
    flag_modified(user, "filter_presets")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
