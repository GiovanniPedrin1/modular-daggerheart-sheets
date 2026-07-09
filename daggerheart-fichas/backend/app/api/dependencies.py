from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import clear_refresh_cookie, get_active_refresh_session
from app.api.errors import api_error
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.models.user import User

DbSession = Annotated[AsyncSession, Depends(get_db_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


async def require_current_user(
    request: Request,
    response: Response,
    session: DbSession,
    settings: SettingsDep,
) -> User:
    active_session = await get_active_refresh_session(
        session,
        settings=settings,
        token=request.cookies.get(settings.session_cookie_name),
    )

    if active_session is None:
        clear_refresh_cookie(response, settings=settings)
        cookie_header = response.headers.get("set-cookie")
        raise api_error(
            status.HTTP_401_UNAUTHORIZED,
            "SESSION_EXPIRED",
            "Your session has expired. Please sign in again.",
            headers={"set-cookie": cookie_header} if cookie_header else None,
        )

    return active_session.user


CurrentUser = Annotated[User, Depends(require_current_user)]
