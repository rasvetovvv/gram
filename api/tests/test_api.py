from __future__ import annotations

import gzip
import json
import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app import giftart
from app.models import Message, User

DEMO_PASSWORD = "GramDemo!2026"  # noqa: S105 - documented local-only fixture


async def login_demo(client: AsyncClient) -> dict[str, object]:
    response = await client.post(
        "/api/auth/login",
        json={"identifier": "leon", "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_auth_registration_onboarding_refresh_and_logout(client: AsyncClient) -> None:
    health = await client.get("/health")
    assert health.json() == {"status": "ok", "service": "gram-api", "database": "ok"}
    assert (await client.get("/api/auth/me")).status_code == 401

    registered = await client.post(
        "/api/auth/register",
        json={"email": "new@gram.local", "password": "VerySecure!2026"},
    )
    assert registered.status_code == 201, registered.text
    assert registered.json()["user"]["onboarding_complete"] is False
    assert client.cookies.get("gram_access")
    old_refresh = client.cookies.get("gram_refresh")

    completed = await client.patch(
        "/api/users/me",
        json={
            "username": "newcomer",
            "display_name": "Новый автор",
            "interests": ["дизайн", "сообщества", "дизайн"],
            "onboarding_complete": True,
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["username"] == "newcomer"
    assert completed.json()["interests"] == ["дизайн", "сообщества"]
    assert completed.json()["onboarding_complete"] is True

    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200, refreshed.text
    assert client.cookies.get("gram_refresh") != old_refresh

    logged_out = await client.post("/api/auth/logout")
    assert logged_out.json() == {"detail": "signed_out"}
    assert (await client.get("/api/users/me")).status_code == 401
    await login_demo(client)
    signed_out_profile = await client.get("/api/users/newcomer")
    assert signed_out_profile.json()["is_online"] is False
    assert signed_out_profile.json()["last_seen_at"] is not None
    await client.post("/api/auth/logout")
    wrong = await client.post(
        "/api/auth/login", json={"identifier": "newcomer", "password": "wrong"}
    )
    assert wrong.status_code == 401


async def test_feed_follow_comments_bookmarks_reposts_and_direct_chat(client: AsyncClient) -> None:
    await login_demo(client)
    follow = await client.post("/api/users/artem/follow")
    assert follow.status_code == 200
    assert follow.json()["is_following"] is True

    following_feed = await client.get("/api/feed", params={"mode": "following"})
    assert following_feed.status_code == 200
    assert {post["author"]["username"] for post in following_feed.json()} <= {"leon", "artem"}
    target_post = following_feed.json()[0]

    comment = await client.post(
        f"/api/feed/{target_post['id']}/comments", json={"content": "Рабочий комментарий"}
    )
    assert comment.status_code == 201
    assert (await client.get(f"/api/feed/{target_post['id']}/comments")).json()
    assert (await client.post(f"/api/feed/{target_post['id']}/bookmark")).json()["active"]
    assert (await client.post(f"/api/feed/{target_post['id']}/repost")).json()["active"]
    bookmarks = await client.get("/api/feed/bookmarks")
    assert any(post["id"] == target_post["id"] for post in bookmarks.json())

    direct = await client.post("/api/chats/direct/artem")
    repeated = await client.post("/api/chats/direct/artem")
    assert direct.status_code == 200
    assert direct.json()["id"] == repeated.json()["id"]
    sent = await client.post(
        f"/api/chats/{direct.json()['id']}/messages", json={"content": "Привет из теста"}
    )
    assert sent.status_code == 201
    assert (await client.delete("/api/users/artem/follow")).json()["is_following"] is False


async def test_stars_ledger_and_creator_subscription_are_atomic(client: AsyncClient) -> None:
    await login_demo(client)
    initial = (await client.get("/api/stars/wallet")).json()["balance"]
    transfer = await client.post(
        "/api/stars/send",
        json={"to_username": "artem", "amount": 25, "message": "За полезный пост"},
    )
    assert transfer.status_code == 200, transfer.text
    assert transfer.json()["balance"] == initial - 25

    subscribed = await client.post("/api/users/artem/subscribe", json={"price_stars": 1})
    assert subscribed.status_code == 200, subscribed.text
    assert subscribed.json()["price_stars"] == 50
    wallet = await client.get("/api/stars/wallet")
    assert wallet.json()["balance"] == initial - 75
    kinds = {entry["kind"] for entry in (await client.get("/api/stars/transactions")).json()}
    assert {"transfer_sent", "subscription"} <= kinds
    cancelled = await client.delete("/api/users/artem/subscribe")
    assert cancelled.json()["active"] is False


async def test_communities_membership_and_posts(client: AsyncClient) -> None:
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "member@gram.local",
            "password": "MemberPass!2026",
            "username": "member",
            "display_name": "Участник",
        },
    )
    assert registered.status_code == 201
    joined = await client.post("/api/communities/digital-objects/join")
    assert joined.status_code == 200
    assert joined.json()["is_member"] is True
    # A community speaks as itself: joining lets you read and subscribe, not publish.
    refused = await client.post(
        "/api/communities/digital-objects/posts",
        json={"content": "Моя первая публикация в сообществе"},
    )
    assert refused.status_code == 403, refused.text
    assert "владелец" in refused.json()["detail"]
    left = await client.delete("/api/communities/digital-objects/leave")
    assert left.json()["is_member"] is False

    created = await client.post(
        "/api/communities",
        json={
            "slug": "rounded-ui",
            "title": "Мягкие интерфейсы",
            "description": "Практика",
            "category": "Дизайн",
            "location": "Тбилиси",
            "website_url": "https://example.com/rounded",
        },
    )
    assert created.status_code == 201
    assert created.json()["is_owner"] is True
    assert created.json()["category"] == "Дизайн"
    assert created.json()["location"] == "Тбилиси"
    assert created.json()["website_url"] == "https://example.com/rounded"
    # The owner of a community publishes in it, and the post shows up in its list.
    own = await client.post(
        "/api/communities/rounded-ui/posts", json={"content": "Первый пост канала"}
    )
    assert own.status_code == 201, own.text
    posts = await client.get("/api/communities/rounded-ui/posts")
    assert any(item["id"] == own.json()["id"] for item in posts.json())
    seeded = await client.get("/api/communities/digital-objects")
    assert seeded.json()["category"] == "Цифровые объекты"
    assert seeded.json()["location"] == "Киев"
    assert (await client.delete("/api/communities/rounded-ui/leave")).status_code == 409


async def test_gift_showcase_offer_provenance_and_username_purchase(client: AsyncClient) -> None:
    await login_demo(client)
    gifts = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    assert len(gifts) >= 2
    # The marker beside the name is a premium arrangement, so a free account is told so.
    refused = await client.patch(
        "/api/users/me/showcase",
        json={"featured_gift_id": gifts[0]["id"], "name_gift_id": gifts[1]["id"]},
    )
    assert refused.status_code == 402, refused.text
    assert "Premium" in refused.json()["detail"]
    showcased = await client.patch(
        "/api/users/me/showcase", json={"featured_gift_id": gifts[0]["id"]}
    )
    assert showcased.status_code == 200, showcased.text
    assert showcased.json()["featured_gift"]["id"] == gifts[0]["id"]
    assert [item["id"] for item in showcased.json()["cover_gifts"]] == [gifts[0]["id"]]
    detail = await client.get(f"/api/gifts/{gifts[0]['id']}")
    assert detail.json()["traits"]
    assert detail.json()["value_stars"] > 0
    assert detail.json()["provenance"][0]["event"] == "minted"

    await client.post("/api/auth/logout")
    buyer = await client.post(
        "/api/auth/register",
        json={
            "email": "buyer@gram.local",
            "password": "BuyerPass!2026",
            "username": "buyer",
            "display_name": "Покупатель",
        },
    )
    assert buyer.status_code == 201
    offer = await client.post(f"/api/gifts/{gifts[0]['id']}/offers", json={"amount_stars": 80})
    assert offer.status_code == 201, offer.text
    await client.post("/api/auth/logout")
    await login_demo(client)
    accepted = await client.post(f"/api/gifts/offers/{offer.json()['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["owner_username"] == "buyer"
    assert len((await client.get(f"/api/gifts/{gifts[0]['id']}/provenance")).json()) == 2

    listed = next(
        item for item in (await client.get("/api/usernames")).json() if item["username"] == "north"
    )
    await client.post("/api/auth/logout")
    await client.post("/api/auth/login", json={"identifier": "buyer", "password": "BuyerPass!2026"})
    await client.post("/api/stars/top-up", json={"amount": 1000})
    purchased = await client.post(f"/api/usernames/{listed['id']}/purchase")
    assert purchased.status_code == 200, purchased.text
    assert purchased.json()["owner_username"] == "buyer"
    history = await client.get(f"/api/usernames/{listed['id']}/history")
    assert history.json()[0]["action"] == "acquired"


async def test_avatar_and_cover_upload_validation(client: AsyncClient) -> None:
    await login_demo(client)
    image_bytes = BytesIO()
    Image.new("RGB", (32, 32), "#6d5dfc").save(image_bytes, format="WEBP")
    uploaded = await client.post(
        "/api/users/me/avatar",
        files={"file": ("avatar.webp", image_bytes.getvalue(), "image/webp")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["avatar_url"].startswith("/media/avatars/")
    invalid = await client.post(
        "/api/users/me/cover",
        files={"file": ("fake.png", b"not-an-image", "image/png")},
    )
    assert invalid.status_code == 422


async def test_notification_read_actions(client: AsyncClient) -> None:
    await login_demo(client)
    notifications = (await client.get("/api/notifications")).json()
    assert notifications
    single = await client.post(f"/api/notifications/{notifications[0]['id']}/read")
    assert single.json()["is_read"] is True
    assert (await client.post("/api/notifications/read-all")).json() == {"detail": "read"}
    assert all(item["is_read"] for item in (await client.get("/api/notifications")).json())


async def test_profile_details_related_usernames_and_subscription_contract(
    client: AsyncClient,
) -> None:
    await login_demo(client)
    creator = await client.get("/api/users/artem")
    assert creator.status_code == 200, creator.text
    assert creator.json()["paid_subscription_enabled"] is True
    assert creator.json()["subscription_price_stars"] == 50
    assert creator.json()["role_title"] == "Type designer"
    alias = await client.get("/api/users/mono")
    assert alias.status_code == 200, alias.text
    assert alias.json()["username"] == "artem"

    updated = await client.patch(
        "/api/users/me",
        json={
            "related_usernames": ["@Artem", "maya", "@artem"],
            "website_url": "https://example.com/leon",
            "birthday": "1997-05-14",
            "github_url": "https://github.com/example",
            "telegram_url": "https://t.me/example",
            "profile_song_title": "Test song",
            "profile_song_artist": "Test artist",
            "profile_song_url": "/media/songs/test.mp3",
            "featured_community_slug": "digital-objects",
            "role_title": "Product builder",
            "streak_days": 151,
        },
    )
    assert updated.status_code == 200, updated.text
    profile = updated.json()
    # Handles that belong to other accounts are dropped; owned collectibles are listed.
    assert set(profile["related_usernames"]) == {"afterglow", "north", "still"}
    assert "artem" not in profile["related_usernames"]
    assert "leon" not in profile["related_usernames"]
    assert profile["website_url"] == "https://example.com/leon"
    assert profile["birthday"] == "1997-05-14"
    assert profile["profile_song_url"] == "/media/songs/test.mp3"
    assert profile["featured_community_slug"] == "digital-objects"
    assert profile["role_title"] == "Product builder"
    assert profile["streak_days"] == 151
    assert profile["updated_at"] is not None
    persisted = (await client.get("/api/users/me")).json()
    assert set(persisted["related_usernames"]) == {"afterglow", "north", "still"}
    assert persisted["github_url"] == "https://github.com/example"

    invalid_url = await client.patch("/api/users/me", json={"website_url": "javascript:alert(1)"})
    assert invalid_url.status_code == 422
    invalid_related = await client.patch(
        "/api/users/me", json={"related_usernames": ["not a username"]}
    )
    assert invalid_related.status_code == 422
    invalid_community = await client.patch(
        "/api/users/me", json={"featured_community_slug": "missing-community"}
    )
    assert invalid_community.status_code == 422


async def test_profile_stories_expiration_delete_ownership_and_replies(
    client: AsyncClient,
) -> None:
    await login_demo(client)
    seeded = await client.get("/api/users/leon/stories")
    assert seeded.status_code == 200, seeded.text
    assert len(seeded.json()) >= 2
    assert any(story["highlight"] for story in seeded.json())

    expired = await client.post(
        "/api/users/me/stories",
        json={
            "title": "Expired ephemeral",
            "media_url": "https://images.unsplash.com/photo-1519608487953-e999c86e7455",
            "expires_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
            "highlight": False,
        },
    )
    assert expired.status_code == 201, expired.text
    visible_ids = {story["id"] for story in (await client.get("/api/users/leon/stories")).json()}
    assert expired.json()["id"] not in visible_ids

    created = await client.post(
        "/api/users/me/stories",
        json={
            "title": "Fresh story",
            "media_url": "/media/stories/fresh.webp",
            "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
            "highlight": False,
        },
    )
    assert created.status_code == 201, created.text
    visible_ids = {story["id"] for story in (await client.get("/api/users/leon/stories")).json()}
    assert created.json()["id"] in visible_ids

    artem_story = (await client.get("/api/users/artem/stories")).json()[0]
    forbidden = await client.delete(f"/api/users/me/stories/{artem_story['id']}")
    assert forbidden.status_code == 403
    deleted = await client.delete(f"/api/users/me/stories/{created.json()['id']}")
    assert deleted.json() == {"detail": "deleted"}

    replies = await client.get("/api/users/artem/replies")
    assert replies.status_code == 200, replies.text
    assert replies.json()
    reply = replies.json()[0]
    assert reply["author"]["username"] == "artem"
    assert reply["post_id"] == reply["parent_post"]["id"]
    assert reply["parent_post"]["author"]["username"] == "leon"
    assert reply["parent_post"]["content"]

    followers = await client.get("/api/users/leon/followers")
    following = await client.get("/api/users/leon/following")
    assert {user["username"] for user in followers.json()} >= {"artem", "maya"}
    assert {user["username"] for user in following.json()} >= {"artem"}
    profile = (await client.get("/api/users/leon")).json()
    assert profile["followers_count"] == len(followers.json())
    assert profile["following_count"] == len(following.json())


async def test_profile_showcase_drops_gifts_the_owner_transferred_away(
    client: AsyncClient,
) -> None:
    await login_demo(client)
    profile = (await client.get("/api/users/me")).json()
    featured = profile["featured_gift"]
    assert featured, "demo owner starts with a showcased gift"

    transferred = await client.post(
        f"/api/gifts/{featured['id']}/transfer", json={"to_username": "@Maya"}
    )
    assert transferred.status_code == 200, transferred.text
    assert transferred.json()["owner_username"] == "maya"

    after = (await client.get("/api/users/me")).json()
    assert after["featured_gift"] is None
    leon_gifts = {gift["id"] for gift in (await client.get("/api/gifts?owner=leon")).json()}
    maya_gifts = {gift["id"] for gift in (await client.get("/api/gifts?owner=@Maya")).json()}
    assert featured["id"] not in leon_gifts
    assert featured["id"] in maya_gifts


async def test_chat_folders_group_conversations_and_count_unread(client: AsyncClient) -> None:
    await login_demo(client)
    assert (await client.get("/api/chats/folders")).json() == []

    created = await client.post("/api/chats/folders", json={"title": "  Работа  "})
    assert created.status_code == 201, created.text
    folder = created.json()
    assert folder["title"] == "Работа"
    assert folder["chats_count"] == 0
    duplicate = await client.post("/api/chats/folders", json={"title": "Работа"})
    assert duplicate.status_code == 409

    chat = await client.post("/api/chats/direct/artem")
    assert chat.status_code == 200, chat.text
    chat_id = chat.json()["id"]

    added = await client.put(f"/api/chats/folders/{folder['id']}/chats/{chat_id}")
    assert added.status_code == 200, added.text
    assert added.json()["chat_ids"] == [chat_id]
    assert added.json()["chats_count"] == 1
    # Adding twice stays idempotent.
    assert (await client.put(f"/api/chats/folders/{folder['id']}/chats/{chat_id}")).json()["chats_count"] == 1

    listed = (await client.get("/api/chats/folders")).json()
    assert [item["title"] for item in listed] == ["Работа"]
    # A folder's badge is the sum of its chats' unread counts.
    chats = {item["id"]: item for item in (await client.get("/api/chats")).json()}
    assert listed[0]["unread_count"] == chats[chat_id]["unread_count"]

    removed = await client.delete(f"/api/chats/folders/{folder['id']}/chats/{chat_id}")
    assert removed.json()["chats_count"] == 0

    missing_chat = await client.put(f"/api/chats/folders/{folder['id']}/chats/{chat_id[:-1]}0")
    assert missing_chat.status_code in {403, 404}

    deleted = await client.delete(f"/api/chats/folders/{folder['id']}")
    assert deleted.json() == {"detail": "folder_deleted"}
    assert (await client.get("/api/chats/folders")).json() == []
    assert (await client.delete(f"/api/chats/folders/{folder['id']}")).status_code == 404


async def test_explore_search_trends_and_hashtag_feed(client: AsyncClient) -> None:
    await login_demo(client)
    trends = await client.get("/api/trends")
    assert trends.status_code == 200, trends.text
    tags = {item["tag"]: item["posts_count"] for item in trends.json()}
    assert "night" in tags and "design" in tags
    assert tags["night"] >= 3
    # The list is ordered by popularity.
    counts = [item["posts_count"] for item in trends.json()]
    assert counts == sorted(counts, reverse=True)

    tagged = await client.get("/api/feed", params={"hashtag": "#Night"})
    assert tagged.status_code == 200, tagged.text
    assert tagged.json()
    assert all("#night" in post["content"].lower() for post in tagged.json())

    people = await client.get("/api/search", params={"q": "@Artem"})
    assert people.status_code == 200, people.text
    assert [user["username"] for user in people.json()["people"]] == ["artem"]
    assert people.json()["people"][0]["profile_color"] == "champagne"

    communities = await client.get("/api/search", params={"q": "объект"})
    assert [item["slug"] for item in communities.json()["communities"]] == ["digital-objects"]
    assert communities.json()["communities"][0]["members_count"] >= 1

    hashtags = await client.get("/api/search", params={"q": "#mus"})
    assert [item["tag"] for item in hashtags.json()["tags"]] == ["music"]

    empty = await client.get("/api/search", params={"q": "zzzzzz"})
    assert empty.json() == {"query": "zzzzzz", "people": [], "communities": [], "tags": []}


async def test_security_sessions_password_change_and_account_deletion(
    client: AsyncClient,
) -> None:
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "leaving@gram.local",
            "password": "LeavingPass!2026",
            "username": "leaving",
            "display_name": "Уходящий",
        },
    )
    assert registered.status_code == 201, registered.text

    sessions = await client.get("/api/auth/sessions")
    assert sessions.status_code == 200, sessions.text
    assert len(sessions.json()) == 1
    assert sessions.json()[0]["current"] is True

    appearance = await client.patch("/api/users/me", json={"profile_color": "ice_blue"})
    assert appearance.status_code == 200, appearance.text
    assert appearance.json()["profile_color"] == "ice_blue"
    assert (await client.patch("/api/users/me", json={"profile_color": "Ice Blue"})).status_code == 422
    # The scheme travels with every compact user, so names are tinted wherever they appear.
    post = await client.post("/api/feed", json={"content": "Цветной ник в ленте"})
    assert post.status_code == 201, post.text
    assert post.json()["author"]["profile_color"] == "ice_blue"
    feed = await client.get("/api/feed", params={"author": "leaving"})
    assert feed.json()[0]["author"]["profile_color"] == "ice_blue"

    wrong = await client.post(
        "/api/auth/password",
        json={"current_password": "nope", "new_password": "AnotherPass!2026"},
    )
    assert wrong.status_code == 401
    same = await client.post(
        "/api/auth/password",
        json={"current_password": "LeavingPass!2026", "new_password": "LeavingPass!2026"},
    )
    assert same.status_code == 422
    changed = await client.post(
        "/api/auth/password",
        json={"current_password": "LeavingPass!2026", "new_password": "AnotherPass!2026"},
    )
    assert changed.json() == {"detail": "password_changed"}
    assert (await client.get("/api/users/me")).status_code == 200

    revoked = await client.delete("/api/auth/sessions")
    assert revoked.json() == {"detail": "sessions_revoked"}

    bad_password = await client.request(
        "DELETE", "/api/users/me", json={"password": "LeavingPass!2026"}
    )
    assert bad_password.status_code == 401
    deleted = await client.request(
        "DELETE", "/api/users/me", json={"password": "AnotherPass!2026"}
    )
    assert deleted.json() == {"detail": "account_deleted"}
    assert (await client.get("/api/users/me")).status_code == 401
    await login_demo(client)
    assert (await client.get("/api/users/leaving")).status_code == 404


async def test_premium_plan_contract_and_stars_checkout(client: AsyncClient) -> None:
    await login_demo(client)
    plan = await client.get("/api/premium/plan")
    assert plan.status_code == 200, plan.text
    body = plan.json()
    assert body["price_stars"] == 750
    assert body["price_fiat"] == 103.99
    assert body["fiat_currency"] == "UAH"
    assert body["period_days"] == 30
    assert body["entitlement"] is None
    assert len(body["benefits"]) == 12
    assert body["benefits"][0]["slug"] == "subscription"
    assert any(benefit["soon"] for benefit in body["benefits"])
    limits = {item["slug"]: item for item in body["limits"]}
    assert limits["post-length"] == {
        "slug": "post-length",
        "title": "Длина поста",
        "free": 280,
        "premium": 1200,
    }
    assert limits["special-marks"]["premium"] == 7
    methods = {item["slug"]: item for item in body["payment_methods"]}
    assert methods["stars"]["available"] is True
    assert methods["card"]["available"] is False
    assert "USDT TON" in methods["crypto"]["badges"]

    topped = await client.post("/api/stars/top-up", json={"amount": 1000})
    assert topped.status_code == 200, topped.text
    balance_before = topped.json()["balance"]
    bought = await client.post("/api/premium/purchase", json={"plan": "monthly"})
    assert bought.status_code == 200, bought.text
    assert bought.json()["price_stars"] == 750
    assert bought.json()["active"] is True

    after = (await client.get("/api/premium/plan")).json()
    assert after["entitlement"]["active"] is True
    assert after["stars_balance"] == balance_before - 750
    assert (await client.get("/api/users/me")).json()["is_premium"] is True


async def test_premium_gift_names_every_refusal(client: AsyncClient) -> None:
    """A present that cannot be delivered says why; a delivered one names its sender."""
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "giver@gram.local",
            "password": "GiverPass!2026",
            "username": "giver",
            "display_name": "Даритель",
        },
    )
    assert registered.status_code == 201, registered.text

    # A new account holds 100 ★, so this also proves the shortfall is counted, not guessed.
    broke = await client.post("/api/premium/gift", json={"username": "maya"})
    assert broke.status_code == 402, broke.text
    assert "Не хватает 650" in broke.json()["detail"]

    await client.post("/api/stars/top-up", json={"amount": 2000})

    missing = await client.post("/api/premium/gift", json={"username": "нет-такого"})
    assert missing.status_code == 404
    assert "нет в GRAM" in missing.json()["detail"]

    myself = await client.post("/api/premium/gift", json={"username": "giver"})
    assert myself.status_code == 409
    assert "Себе Premium не дарят" in myself.json()["detail"]

    before = (await client.get("/api/stars/wallet")).json()["balance"]
    sent = await client.post("/api/premium/gift", json={"username": "maya"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["active"] is True
    assert sent.json()["price_stars"] == 750
    assert sent.json()["gifted_by"]["username"] == "giver"
    assert (await client.get("/api/stars/wallet")).json()["balance"] == before - 750

    # A second present would be wasted, so the refusal carries the date it runs out.
    again = await client.post("/api/premium/gift", json={"username": "maya"})
    assert again.status_code == 409
    assert "уже есть Premium до" in again.json()["detail"]


async def test_gift_catalog_purchase_mints_serials_and_charges_stars(client: AsyncClient) -> None:
    await login_demo(client)
    catalog = await client.get("/api/gifts/catalog")
    assert catalog.status_code == 200, catalog.text
    slugs = {model["slug"]: model for model in catalog.json()}
    # Real Telegram designs, imported from api.changes.tg.
    assert "liberty-figure" in slugs
    assert "ion-gem" in slugs
    design = slugs["liberty-figure"]
    # Price and edition are ours and re-tiered from time to time, so they are read, not pinned.
    price = design["price_stars"]
    edition = design["edition_size"]
    assert design["minted"] == 0
    assert design["sold_out"] is False

    limited = await client.get("/api/gifts/catalog?scope=limited")
    limited_slugs = {model["slug"] for model in limited.json()}
    # The shelf keeps growing, so this pins the filter's behaviour rather than its contents.
    assert "eternal-rose" in limited_slugs
    assert all(model["limited"] for model in limited.json())
    market = await client.get("/api/gifts/catalog?scope=market")
    assert all(model["on_market"] for model in market.json())

    balance_before = (await client.get("/api/stars/wallet")).json()["balance"]
    bought = await client.post(
        "/api/gifts/purchase", json={"slug": "liberty-figure", "to_username": "@Maya"}
    )
    assert bought.status_code == 201, bought.text
    gift = bought.json()["gifts"][0]
    assert bought.json()["spent_stars"] == price
    assert gift["serial_number"] == 1
    assert gift["owner_username"] == "maya"
    assert gift["edition_size"] == edition
    assert gift["value_stars"] == price
    assert gift["provenance_hash"]

    wallet = (await client.get("/api/stars/wallet")).json()
    assert wallet["balance"] == balance_before - price
    ledger = (await client.get("/api/stars/transactions")).json()
    assert ledger[0]["kind"] == "gift_purchase"
    assert ledger[0]["amount"] == -price

    again = await client.post("/api/gifts/purchase", json={"slug": "liberty-figure"})
    assert again.status_code == 201, again.text
    assert again.json()["gifts"][0]["serial_number"] == 2
    assert again.json()["gifts"][0]["owner_username"] == "leon"

    refreshed = {model["slug"]: model for model in (await client.get("/api/gifts/catalog")).json()}
    assert refreshed["liberty-figure"]["minted"] == 2
    assert refreshed["liberty-figure"]["remaining"] == edition - 2

    missing = await client.post("/api/gifts/purchase", json={"slug": "nope"})
    assert missing.status_code == 404
    unknown_recipient = await client.post(
        "/api/gifts/purchase", json={"slug": "liberty-figure", "to_username": "ghost"}
    )
    assert unknown_recipient.status_code == 404


async def test_buying_a_limited_design_mints_a_plain_gift_that_upgrades_for_stars(
    client: AsyncClient,
) -> None:
    """A purchase buys the design; the upgrade is what rolls a model, a backdrop and a symbol."""
    await login_demo(client)
    await client.post("/api/stars/top-up", json={"amount": 2000})
    design = await client.get("/api/gifts/catalog/eternal-rose")
    assert design.status_code == 200, design.text
    body = design.json()
    assert body["limited"] is True
    # Pools are what make two copies of one design differ; percentages sum to 100.
    assert len(body["models"]) == body["models_count"] >= 8
    assert round(sum(item["rarity_percent"] for item in body["backdrops"])) == 100
    assert body["upgrade_price_stars"] > 0

    balance_before = (await client.get("/api/stars/wallet")).json()["balance"]
    bought = await client.post("/api/gifts/purchase", json={"slug": "eternal-rose"})
    assert bought.status_code == 201, bought.text
    mine = bought.json()["gifts"][0]
    assert mine["owner_username"] == "leon"
    assert mine["is_owned_by_me"] is True
    # Plain on arrival: nothing rolled, and no note from anyone.
    assert mine["upgraded"] is False
    assert mine["model_name"] == ""
    assert mine["message"] is None
    assert mine["design_slug"] == "eternal-rose"
    wallet = (await client.get("/api/stars/wallet")).json()
    assert wallet["balance"] == balance_before - body["price_stars"]

    upgraded = await client.post(f"/api/gifts/{mine['id']}/upgrade")
    assert upgraded.status_code == 200, upgraded.text
    rolled = upgraded.json()
    assert rolled["upgraded"] is True
    assert rolled["model"] in {item["name"] for item in body["models"]}
    assert rolled["backdrop"] in {item["name"] for item in body["backdrops"]}
    assert rolled["symbol"] in {item["name"] for item in body["symbols"]}
    assert rolled["traits"]["model_rarity_percent"] > 0
    assert (await client.get("/api/stars/wallet")).json()["balance"] == (
        wallet["balance"] - body["upgrade_price_stars"]
    )
    # Rolling twice would make the rarest model a matter of paying until it appeared.
    again = await client.post(f"/api/gifts/{mine['id']}/upgrade")
    assert again.status_code == 409
    assert "уже улучшен" in again.json()["detail"]

    # Buying for yourself announces nothing: there is no counterparty to tell.
    assert not [
        item
        for item in (await client.get("/api/notifications")).json()
        if item["entity_id"] == mine["id"]
    ]


async def test_listing_a_gift_lets_another_account_buy_it_outright(client: AsyncClient) -> None:
    """A listed price is an answer already given, so buying takes one action, not a bid."""
    await login_demo(client)
    owned = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    gift = next(item for item in owned if not item["is_listed"])
    listed = await client.put(f"/api/gifts/{gift['id']}/listing", json={"price_stars": 640})
    assert listed.status_code == 200, listed.text
    assert listed.json()["is_listed"] is True
    assert listed.json()["sale_price_stars"] == 640
    market = (await client.get("/api/gifts/market")).json()
    entry = next(item for item in market if item["gift_id"] == gift["id"])
    assert entry["price_stars"] == 640
    assert entry["is_mine"] is True
    assert entry["owner"]["username"] == "leon"
    # The storefront row for that design now advertises a floor price from real stock.
    design = (await client.get(f"/api/gifts/catalog/{entry['design_slug']}")).json()
    assert design["resale_count"] >= 1
    assert design["resale_floor_stars"] <= 640
    assert gift["id"] in {item["gift_id"] for item in design["resale"]}
    # Listing does not let the owner buy from themselves.
    assert (await client.post(f"/api/gifts/{gift['id']}/buy")).status_code == 400
    seller_balance = (await client.get("/api/stars/wallet")).json()["balance"]

    await client.post("/api/auth/logout")
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "collector@gram.local",
            "password": "Collector!2026",
            "username": "collector",
            "display_name": "Коллекционер",
        },
    )
    assert registered.status_code == 201, registered.text
    opening_balance = (await client.get("/api/stars/wallet")).json()["balance"]
    broke = await client.post(f"/api/gifts/{gift['id']}/buy")
    assert broke.status_code == 409, broke.text
    await client.post("/api/stars/top-up", json={"amount": 1000})
    bought = await client.post(f"/api/gifts/{gift['id']}/buy")
    assert bought.status_code == 200, bought.text
    assert bought.json()["owner_username"] == "collector"
    assert bought.json()["is_listed"] is False
    buyer_wallet = (await client.get("/api/stars/wallet")).json()
    assert buyer_wallet["balance"] == opening_balance + 1000 - 640
    # Selling clears the listing, so a second attempt finds nothing on sale rather than
    # charging twice.
    assert (await client.post(f"/api/gifts/{gift['id']}/buy")).status_code == 409
    on_sale = {item["gift_id"] for item in (await client.get("/api/gifts/market")).json()}
    assert gift["id"] not in on_sale

    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.get("/api/stars/wallet")).json()["balance"] == seller_balance + 640
    sale = (await client.get("/api/stars/transactions")).json()[0]
    assert sale["kind"] == "gift_sale"
    assert sale["amount"] == 640
    assert any(
        item["entity_id"] == gift["id"] and "купил" in item["text"]
        for item in (await client.get("/api/notifications")).json()
    )


async def test_a_received_gift_is_plain_and_only_its_owner_can_upgrade_it(
    client: AsyncClient,
) -> None:
    """Anonymity and the note belong to the gift; the roll belongs to whoever owns it."""
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "birthday@gram.local",
            "password": "Birthday!2026",
            "username": "birthday",
            "display_name": "Именинник",
        },
    )
    assert registered.status_code == 201, registered.text
    await client.post("/api/auth/logout")

    await login_demo(client)
    await client.post("/api/stars/top-up", json={"amount": 500})
    sent = await client.post(
        "/api/gifts/purchase",
        json={
            "slug": "b-day-candle",
            "to_username": "@Birthday",
            "message": "С днём рождения!",
            "hide_my_name": True,
        },
    )
    assert sent.status_code == 201, sent.text
    minted = sent.json()["gifts"][0]
    gift_id = minted["id"]
    assert minted["upgraded"] is False
    # Hiding the name hides it from the recipient. The buyer still sees that they gave it —
    # they are not hiding it from themselves, and a gift you sent must say so when you open it.
    assert minted["sender_hidden"] is True
    assert minted["sent_by_me"] is True
    assert minted["sender"]["username"] == "leon"
    assert minted["message"] == "С днём рождения!"
    # An anonymous gift arrives without an actor attached to its notification.
    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/login", json={"identifier": "birthday", "password": "Birthday!2026"}
    )
    arrival = next(
        item
        for item in (await client.get("/api/notifications")).json()
        if item["entity_id"] == gift_id
    )
    assert arrival["actor"] is None
    assert arrival["text"].startswith("Кто-то")
    # And the recipient's own view of the item still does not name the buyer.
    theirs = (await client.get(f"/api/gifts/{gift_id}")).json()
    assert theirs["sender"] is None
    assert theirs["sent_by_me"] is False

    assert (await client.get(f"/api/gifts/{gift_id}")).json()["upgraded"] is False
    # The recipient pays the fee and the roll happens against their own item.
    await client.post("/api/stars/top-up", json={"amount": 500})
    upgraded = await client.post(f"/api/gifts/{gift_id}/upgrade")
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["upgraded"] is True
    assert upgraded.json()["model"]

    # Only the owner may upgrade it, and an upgraded gift cannot be rolled again.
    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.post(f"/api/gifts/{gift_id}/upgrade")).status_code == 403


async def test_gift_catalog_supports_categories_search_and_sorting(client: AsyncClient) -> None:
    await login_demo(client)
    categories = (await client.get("/api/gifts/categories")).json()
    keys = {item["key"] for item in categories}
    assert {"classic", "holiday", "mystic", "luxury"} <= keys
    assert all(item["count"] > 0 and item["label"] for item in categories)
    total = sum(item["count"] for item in categories)
    assert total == len((await client.get("/api/gifts/catalog")).json())

    holiday = (await client.get("/api/gifts/catalog?category=holiday")).json()
    assert holiday
    assert all(item["category"] == "holiday" for item in holiday)
    assert {item["category_label"] for item in holiday} == {"Праздники"}

    found = (await client.get("/api/gifts/catalog?q=rose")).json()
    assert "eternal-rose" in [item["slug"] for item in found]

    expensive = (await client.get("/api/gifts/catalog?sort=price-desc")).json()
    prices = [item["price_stars"] for item in expensive]
    assert prices == sorted(prices, reverse=True)
    by_rarity = (await client.get("/api/gifts/catalog?sort=rarity")).json()
    assert by_rarity[0]["rarity"] == "legendary"
    assert by_rarity[-1]["rarity"] == "rare"
    # Every design is drawn locally, so nothing in the catalogue depends on a remote render.
    assert all(item["image_url"] is None and item["art"] for item in expensive)


async def test_username_ownership_rules_and_primary_handle_switch(client: AsyncClient) -> None:
    await login_demo(client)
    # A live account's handle cannot be reserved as a collectible by someone else.
    stolen = await client.post("/api/usernames/reserve", json={"username": "artem"})
    assert stolen.status_code == 409, stolen.text

    reserved = await client.post("/api/usernames/reserve", json={"username": "@NightCity"})
    assert reserved.status_code == 201, reserved.text
    asset_id = reserved.json()["id"]
    assert reserved.json()["username"] == "nightcity"
    assert reserved.json()["is_owned_by_me"] is True

    listed = await client.patch(
        f"/api/usernames/{asset_id}/listing", json={"for_sale": True, "price": 400}
    )
    assert listed.status_code == 200, listed.text
    blocked = await client.post(f"/api/usernames/{asset_id}/activate")
    assert blocked.status_code == 409, blocked.text

    unlisted = await client.patch(f"/api/usernames/{asset_id}/listing", json={"for_sale": False})
    assert unlisted.status_code == 200, unlisted.text

    activated = await client.post(f"/api/usernames/{asset_id}/activate")
    assert activated.status_code == 200, activated.text
    assert activated.json()["username"] == "nightcity"
    # The previous handle stays owned, so it cannot be sniped after the switch.
    assert "leon" in activated.json()["related_usernames"]
    owned = {
        asset["username"]: asset for asset in (await client.get("/api/usernames")).json()
    }
    assert owned["leon"]["is_owned_by_me"] is True
    assert owned["leon"]["status"] == "reserved"
    assert (await client.get("/api/users/leon")).json()["username"] == "nightcity"

    history = await client.get(f"/api/usernames/{asset_id}/history")
    assert history.status_code == 200, history.text
    assert {event["action"] for event in history.json()} >= {"reserved", "profile_username"}


async def test_badges_are_structured_objects_with_catalog_endpoints(client: AsyncClient) -> None:
    await login_demo(client)
    profile = (await client.get("/api/users/leon")).json()
    badges = profile["badges"]
    assert badges and isinstance(badges[0], dict)
    developer = next(badge for badge in badges if badge["slug"] == "maker")
    assert developer["title"] == "Разработчик"
    assert developer["rarity"] == "epic"
    assert developer["points"] == 50
    assert developer["qualification"]
    assert developer["issuer"] == "GRAM"
    assert developer["visible_in_profile"] is True

    catalog = await client.get("/api/badges")
    assert catalog.status_code == 200, catalog.text
    assert {badge["slug"] for badge in catalog.json()} >= {"founder", "legend", "sponsor", "maker"}

    single = await client.get("/api/badges/legend")
    assert single.status_code == 200, single.text
    assert single.json()["title"] == "Легенда"
    assert (await client.get("/api/badges/nope")).status_code == 404

    by_user = await client.get("/api/users/leon/badges")
    assert by_user.status_code == 200, by_user.text
    assert [badge["slug"] for badge in by_user.json()] == [badge["slug"] for badge in badges]
    assert (await client.get("/api/users/ghost/badges")).status_code == 404


async def test_collectible_username_aliases_resolve_across_profile_endpoints(
    client: AsyncClient,
) -> None:
    await login_demo(client)
    # `afterglow` is a collectible username owned by `leon`, so every profile-scoped
    # endpoint must resolve it to the same account instead of returning 404.
    assert (await client.get("/api/users/afterglow")).json()["username"] == "leon"
    assert (await client.get("/api/users/%40afterglow")).json()["username"] == "leon"
    assert (await client.get("/api/users/AfterGlow")).json()["username"] == "leon"

    alias_badges = await client.get("/api/users/afterglow/badges")
    canonical_badges = await client.get("/api/users/leon/badges")
    assert alias_badges.json() == canonical_badges.json()

    for path in ("stories", "replies", "followers", "following"):
        alias = await client.get(f"/api/users/afterglow/{path}")
        canonical = await client.get(f"/api/users/leon/{path}")
        assert alias.status_code == 200, alias.text
        assert alias.json() == canonical.json()

    alias_feed = await client.get("/api/feed?author=@AfterGlow")
    canonical_feed = await client.get("/api/feed?author=leon")
    assert alias_feed.json() == canonical_feed.json()
    assert canonical_feed.json()
    assert (await client.get("/api/feed?author=ghost")).json() == []

    alias_gifts = await client.get("/api/gifts?owner=afterglow")
    canonical_gifts = await client.get("/api/gifts?owner=leon")
    assert alias_gifts.json() == canonical_gifts.json()
    assert (await client.get("/api/gifts?owner=ghost")).json() == []

    chat = await client.post("/api/chats/direct/mono")
    assert chat.status_code in {200, 201}, chat.text
    assert chat.json()["peer"]["username"] == "artem"


async def test_gift_offer_notifies_owner_and_supports_decline(client: AsyncClient) -> None:
    """An offer used to arrive silently and could only ever be accepted."""
    await login_demo(client)
    gifts = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    gift_id = gifts[0]["id"]
    before = len((await client.get("/api/notifications")).json())

    await client.post("/api/auth/logout")
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "bidder@gram.local",
            "password": "BidderPass!2026",
            "username": "bidder",
            "display_name": "Претендент",
        },
    )
    assert registered.status_code == 201, registered.text
    await client.post("/api/stars/top-up", json={"amount": 500})
    offer = await client.post(f"/api/gifts/{gift_id}/offers", json={"amount_stars": 70})
    assert offer.status_code == 201, offer.text
    offer_id = offer.json()["id"]

    await client.post("/api/auth/logout")
    await login_demo(client)
    # The owner is told about the offer and can see it without opening the gift.
    notifications = (await client.get("/api/notifications")).json()
    assert len(notifications) == before + 1
    assert "70" in notifications[0]["text"]
    incoming = await client.get("/api/gifts/offers/incoming")
    assert incoming.status_code == 200, incoming.text
    assert [item["id"] for item in incoming.json()] == [offer_id]

    declined = await client.post(f"/api/gifts/offers/{offer_id}/decline")
    assert declined.status_code == 200, declined.text
    assert declined.json()["status"] == "declined"
    assert (await client.get("/api/gifts/offers/incoming")).json() == []
    # Declining twice is a conflict, and the gift stays with its owner.
    assert (await client.post(f"/api/gifts/offers/{offer_id}/decline")).status_code == 409
    assert (await client.get(f"/api/gifts/{gift_id}")).json()["owner_username"] == "leon"

    await client.post("/api/auth/logout")
    login = await client.post(
        "/api/auth/login", json={"identifier": "bidder@gram.local", "password": "BidderPass!2026"}
    )
    assert login.status_code == 200, login.text
    buyer_notifications = (await client.get("/api/notifications")).json()
    assert any("отклонил" in item["text"] for item in buyer_notifications)


async def test_buyer_can_cancel_pending_gift_offer(client: AsyncClient) -> None:
    await login_demo(client)
    gift_id = (await client.get("/api/gifts", params={"owner": "leon"})).json()[0]["id"]
    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "canceller@gram.local",
            "password": "CancelPass!2026",
            "username": "canceller",
            "display_name": "Отменяющий",
        },
    )
    await client.post("/api/stars/top-up", json={"amount": 300})
    offer_id = (
        await client.post(f"/api/gifts/{gift_id}/offers", json={"amount_stars": 60})
    ).json()["id"]
    cancelled = await client.post(f"/api/gifts/offers/{offer_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    # Only the owner may resolve offers, and a cancelled one can no longer be accepted.
    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.post(f"/api/gifts/offers/{offer_id}/accept")).status_code == 409


async def test_incoming_offers_follow_current_gift_owner(client: AsyncClient) -> None:
    """A pending offer belongs to whoever holds the gift now, not the original seller."""
    await login_demo(client)
    gift_id = (await client.get("/api/gifts", params={"owner": "leon"})).json()[0]["id"]

    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "holder@gram.local",
            "password": "HolderPass!2026",
            "username": "holder",
            "display_name": "Держатель",
        },
    )
    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "watcher@gram.local",
            "password": "WatcherPass!2026",
            "username": "watcher",
            "display_name": "Наблюдатель",
        },
    )
    await client.post("/api/stars/top-up", json={"amount": 400})
    offer_id = (
        await client.post(f"/api/gifts/{gift_id}/offers", json={"amount_stars": 50})
    ).json()["id"]

    await client.post("/api/auth/logout")
    await login_demo(client)
    incoming = [item["id"] for item in (await client.get("/api/gifts/offers/incoming")).json()]
    assert offer_id in incoming

    # Hand the gift on while the offer is still open.
    handed = await client.post(f"/api/gifts/{gift_id}/transfer", json={"to_username": "holder"})
    assert handed.status_code == 200, handed.text
    assert (await client.get("/api/gifts/offers/incoming")).json() == []
    # The previous owner can no longer resolve it either.
    assert (await client.post(f"/api/gifts/offers/{offer_id}/decline")).status_code == 403

    await client.post("/api/auth/logout")
    login = await client.post(
        "/api/auth/login", json={"identifier": "holder@gram.local", "password": "HolderPass!2026"}
    )
    assert login.status_code == 200, login.text
    assert offer_id in [
        item["id"] for item in (await client.get("/api/gifts/offers/incoming")).json()
    ]
    assert (await client.post(f"/api/gifts/offers/{offer_id}/decline")).status_code == 200


async def test_buyer_sees_own_offers_with_outcome(client: AsyncClient) -> None:
    """A placed bid stays visible to its author, including after it is resolved."""
    await login_demo(client)
    gifts = [
        gift
        for gift in (await client.get("/api/gifts", params={"owner": "leon"})).json()
        if gift["is_owned_by_me"]
    ]
    gift_id = gifts[0]["id"]

    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "tracker@gram.local",
            "password": "TrackerPass!2026",
            "username": "tracker",
            "display_name": "Следящий",
        },
    )
    await client.post("/api/stars/top-up", json={"amount": 400})
    offer_id = (
        await client.post(f"/api/gifts/{gift_id}/offers", json={"amount_stars": 45})
    ).json()["id"]
    outgoing = await client.get("/api/gifts/offers/outgoing")
    assert outgoing.status_code == 200, outgoing.text
    assert [(item["id"], item["status"]) for item in outgoing.json()] == [(offer_id, "pending")]
    # The buyer sees no incoming offers — the two directions must not bleed into each other.
    assert (await client.get("/api/gifts/offers/incoming")).json() == []

    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.post(f"/api/gifts/offers/{offer_id}/decline")).status_code == 200

    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/login",
        json={"identifier": "tracker@gram.local", "password": "TrackerPass!2026"},
    )
    resolved = (await client.get("/api/gifts/offers/outgoing")).json()
    assert [item["status"] for item in resolved] == ["declined"]


async def test_official_account_greets_and_reports_new_device(client: AsyncClient) -> None:
    """Registration and an unfamiliar sign-in both arrive as chats from @gram."""
    registered = await client.post(
        "/api/auth/register",
        json={
            "email": "newcomer@gram.local",
            "password": "NewcomerPass!2026",
            "username": "newcomer",
            "display_name": "Новичок",
        },
        headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0 Safari/537.36"},
    )
    assert registered.status_code == 201, registered.text

    chats = (await client.get("/api/chats")).json()
    official = [chat for chat in chats if chat["peer"]["username"] == "gram"]
    assert len(official) == 1, chats
    messages = (await client.get(f"/api/chats/{official[0]['id']}/messages")).json()
    assert "Добро пожаловать в GRAM" in messages[0]["content"]
    assert "@newcomer" in messages[0]["content"]

    # Every sign-in is announced, as in the reference: a notice only the owner's own logins
    # never trigger is exactly the notice that cannot reveal someone else's.
    await client.post("/api/auth/logout")
    same_device = await client.post(
        "/api/auth/login",
        json={"identifier": "newcomer@gram.local", "password": "NewcomerPass!2026"},
        headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/151.0.0.0 Safari/537.36"},
    )
    assert same_device.status_code == 200, same_device.text
    messages = (await client.get(f"/api/chats/{official[0]['id']}/messages")).json()
    assert len(messages) == 2
    assert messages[-1]["content"].startswith("Новый вход.")
    assert "Chrome 151" in messages[-1]["content"] and "Windows" in messages[-1]["content"]

    await client.post("/api/auth/logout")
    new_device = await client.post(
        "/api/auth/login",
        json={"identifier": "newcomer@gram.local", "password": "NewcomerPass!2026"},
        headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Safari/605.1"},
    )
    assert new_device.status_code == 200, new_device.text
    messages = (await client.get(f"/api/chats/{official[0]['id']}/messages")).json()
    assert len(messages) == 3
    notice = messages[-1]["content"]
    assert notice.startswith("Новый вход.")
    assert "Safari 18" in notice and "iOS" in notice


async def test_message_reply_edit_pin_and_two_scoped_deletes(client: AsyncClient) -> None:
    """Message actions the reference offers: ответить, редактировать, закрепить, удалить."""
    await login_demo(client)
    chat = await client.post("/api/chats/direct/maya")
    chat_id = chat.json()["id"]

    first = await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Первое"})
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    # Ответить: the quote travels with the message instead of being re-fetched per bubble.
    reply = await client.post(
        f"/api/chats/{chat_id}/messages", json={"content": "Ответ", "reply_to_id": first_id}
    )
    assert reply.status_code == 201, reply.text
    assert reply.json()["reply_to"]["content"] == "Первое"
    reply_id = reply.json()["id"]

    # A reply may only point inside the same chat.
    other = await client.post("/api/chats/direct/artem")
    stray = await client.post(
        f"/api/chats/{other.json()['id']}/messages",
        json={"content": "Чужое", "reply_to_id": first_id},
    )
    assert stray.status_code == 400, stray.text

    edited = await client.patch(
        f"/api/chats/{chat_id}/messages/{reply_id}", json={"content": "Ответ, исправленный"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"] == "Ответ, исправленный"
    assert edited.json()["edited_at"]

    # Закрепить: the pin is announced in the thread as a service notice, as in the reference.
    pinned = await client.post(f"/api/chats/{chat_id}/messages/{first_id}/pin")
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned"] is True
    listed = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    notices = [item for item in listed if item["service"]]
    assert len(notices) == 1
    assert notices[0]["content"].startswith("📌")
    assert "Первое" in notices[0]["content"]
    # A service notice is not editable and cannot itself be pinned.
    assert (
        await client.patch(
            f"/api/chats/{chat_id}/messages/{notices[0]['id']}", json={"content": "Правка"}
        )
    ).status_code == 409
    assert (
        await client.post(f"/api/chats/{chat_id}/messages/{notices[0]['id']}/pin")
    ).status_code == 409

    # Pinning another message moves the pin rather than accumulating pins.
    moved = await client.post(f"/api/chats/{chat_id}/messages/{reply_id}/pin")
    assert moved.json()["pinned"] is True
    pins = {
        item["id"]: item["pinned"]
        for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()
    }
    assert pins[first_id] is False
    assert pins[reply_id] is True

    # Удалить у себя: the row survives for the other side but leaves my list.
    hidden = await client.delete(f"/api/chats/{chat_id}/messages/{first_id}?scope=me")
    assert hidden.status_code == 200, hidden.text
    assert first_id not in {
        item["id"] for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()
    }

    # Удалить у всех: the message is gone outright, leaving no tombstone behind.
    recalled = await client.delete(f"/api/chats/{chat_id}/messages/{reply_id}?scope=all")
    assert recalled.status_code == 200, recalled.text
    remaining = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert reply_id not in {item["id"] for item in remaining}
    assert all("удален" not in item["content"].lower() for item in remaining)
    # Acting on it again is a plain 404 — there is nothing left to act on.
    assert (
        await client.patch(f"/api/chats/{chat_id}/messages/{reply_id}", json={"content": "Снова"})
    ).status_code == 404


async def test_deleting_a_quoted_message_keeps_the_reply(client: AsyncClient) -> None:
    """A full delete must not cascade into replies that quoted it."""
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    parent_id = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Исходное"})
    ).json()["id"]
    child_id = (
        await client.post(
            f"/api/chats/{chat_id}/messages", json={"content": "Мой ответ", "reply_to_id": parent_id}
        )
    ).json()["id"]

    assert (
        await client.delete(f"/api/chats/{chat_id}/messages/{parent_id}?scope=all")
    ).status_code == 200
    remaining = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    surviving = [item for item in remaining if item["id"] == child_id]
    assert len(surviving) == 1
    # The reply stays, only its quote goes away with the message it pointed at.
    assert surviving[0]["content"] == "Мой ответ"
    assert surviving[0]["reply_to"] is None


async def test_only_author_may_edit_or_recall_a_message(client: AsyncClient) -> None:
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    mine = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Моё сообщение"})
    ).json()["id"]

    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "outsider@gram.local",
            "password": "OutsiderPass!2026",
            "username": "outsider",
            "display_name": "Посторонний",
        },
    )
    # Not a member at all: the chat is invisible rather than partly editable.
    assert (
        await client.patch(f"/api/chats/{chat_id}/messages/{mine}", json={"content": "Взлом"})
    ).status_code in {403, 404}
    assert (
        await client.delete(f"/api/chats/{chat_id}/messages/{mine}?scope=all")
    ).status_code in {403, 404}


async def test_reactions_toggle_swap_and_clear(client: AsyncClient) -> None:
    """One reaction per person: the same emoji clears it, a different one replaces it."""
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    message_id = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Реакции"})
    ).json()["id"]
    react = f"/api/chats/{chat_id}/messages/{message_id}/reactions"

    first = await client.post(react, json={"emoji": "❤️"})
    assert first.status_code == 200, first.text
    assert [(item["emoji"], item["count"], item["mine"]) for item in first.json()["reactions"]] == [
        ("❤️", 1, True)
    ]
    assert first.json()["reactions"][0]["users"][0]["username"] == "leon"

    swapped = await client.post(react, json={"emoji": "👍"})
    assert [(item["emoji"], item["count"]) for item in swapped.json()["reactions"]] == [("👍", 1)]

    cleared = await client.post(react, json={"emoji": "👍"})
    assert cleared.json()["reactions"] == []
    # The list endpoint agrees with the toggle response.
    listed = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert next(item for item in listed if item["id"] == message_id)["reactions"] == []

    # Two people on the same emoji count as one chip of two.
    await client.post(react, json={"emoji": "🔥"})
    await client.post("/api/auth/logout")
    login = await client.post(
        "/api/auth/login", json={"identifier": "maya@gram.local", "password": "GramDemo!2026"}
    )
    if login.status_code == 200:
        mine = await client.post(react, json={"emoji": "🔥"})
        assert mine.status_code == 200, mine.text
        chip = mine.json()["reactions"][0]
        assert chip["count"] == 2
        assert chip["mine"] is True


async def test_reactions_reject_service_messages_and_outsiders(client: AsyncClient) -> None:
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    message_id = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Закрепи меня"})
    ).json()["id"]
    await client.post(f"/api/chats/{chat_id}/messages/{message_id}/pin")
    notice = next(
        item for item in (await client.get(f"/api/chats/{chat_id}/messages")).json() if item["service"]
    )
    blocked = await client.post(
        f"/api/chats/{chat_id}/messages/{notice['id']}/reactions", json={"emoji": "❤️"}
    )
    assert blocked.status_code == 409, blocked.text

    await client.post("/api/auth/logout")
    await client.post(
        "/api/auth/register",
        json={
            "email": "reactor@gram.local",
            "password": "ReactorPass!2026",
            "username": "reactor",
            "display_name": "Реактор",
        },
    )
    # Not a member: the chat is not theirs to react in.
    assert (
        await client.post(
            f"/api/chats/{chat_id}/messages/{message_id}/reactions", json={"emoji": "❤️"}
        )
    ).status_code in {403, 404}


async def test_gift_purchase_posts_a_card_into_the_chat(client: AsyncClient) -> None:
    """A gift sent to someone shows up in the conversation as a card, not only a notification."""
    await login_demo(client)
    catalog = (await client.get("/api/gifts/catalog")).json()
    affordable = next(item for item in catalog if not item["sold_out"])
    bought = await client.post(
        "/api/gifts/purchase", json={"slug": affordable["slug"], "to_username": "maya"}
    )
    assert bought.status_code in {200, 201}, bought.text
    gift = bought.json()["gifts"][0]

    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    messages = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    card = next((item for item in messages if item.get("gift")), None)
    assert card is not None, messages
    assert card["gift"]["id"] == gift["id"]
    assert card["gift"]["name"] == affordable["name"]
    assert str(gift["serial_number"]) in card["content"]

    # Buying for myself stays out of any conversation.
    before = len((await client.get(f"/api/chats/{chat_id}/messages")).json())
    mine = await client.post("/api/gifts/purchase", json={"slug": affordable["slug"]})
    assert mine.status_code in {200, 201}, mine.text
    assert len((await client.get(f"/api/chats/{chat_id}/messages")).json()) == before


async def test_premium_mark_travels_with_compact_users(client: AsyncClient) -> None:
    """The premium flag must reach feeds and chats, not only the profile."""
    await login_demo(client)
    assert (await client.get("/api/users/me")).json()["is_premium"] is False
    bought = await client.post("/api/premium/purchase", json={"plan": "monthly"})
    assert bought.status_code in {200, 201}, bought.text

    assert (await client.get("/api/users/me")).json()["is_premium"] is True
    mine = [
        post
        for post in (await client.get("/api/feed", params={"author": "leon"})).json()
        if post["author"]["username"] == "leon"
    ]
    assert mine and all(post["author"]["is_premium"] is True for post in mine)

    # A chat peer without premium stays unmarked, so the badge means something.
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    sent = await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Проверка"})
    assert sent.status_code == 201, sent.text
    listed = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert listed[-1]["sender"]["is_premium"] is True
    peer = (await client.get("/api/chats")).json()
    maya = next(chat for chat in peer if chat["peer"]["username"] == "maya")
    assert maya["peer"]["is_premium"] is False


async def register_partner(client: AsyncClient, username: str) -> None:
    """Seeded demo users have no password, so a second real account has to be registered."""
    created = await client.post(
        "/api/auth/register",
        json={"email": f"{username}@gram.local", "password": "PartnerPass!2026"},
    )
    assert created.status_code == 201, created.text
    named = await client.patch(
        "/api/users/me",
        json={"username": username, "display_name": username.title(), "onboarding_complete": True},
    )
    assert named.status_code == 200, named.text
    await client.post("/api/auth/logout")


async def login_as(client: AsyncClient, username: str) -> None:
    signed = await client.post(
        "/api/auth/login", json={"identifier": username, "password": "PartnerPass!2026"}
    )
    assert signed.status_code == 200, signed.text


async def test_chat_state_is_personal_and_delete_clears_only_my_side(
    client: AsyncClient,
) -> None:
    """Pin, archive, mark-unread and delete are one participant's view of a shared chat."""
    await register_partner(client, "pinpal")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/pinpal")).json()["id"]
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Привет"})

    pinned = await client.patch(f"/api/chats/{chat_id}/state", json={"pinned": True})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned"] is True
    # A pinned conversation leads the list regardless of when it was last used.
    assert (await client.get("/api/chats")).json()[0]["id"] == chat_id

    archived = await client.patch(f"/api/chats/{chat_id}/state", json={"archived": True})
    assert archived.json()["archived"] is True
    listed = next(
        chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id
    )
    assert listed["archived"] is True

    # Reading the chat clears unread; marking it unread by hand puts the badge back.
    await client.get(f"/api/chats/{chat_id}/messages")
    marked = await client.patch(f"/api/chats/{chat_id}/state", json={"marked_unread": True})
    assert marked.json()["marked_unread"] is True
    assert marked.json()["unread_count"] >= 1

    deleted = await client.delete(f"/api/chats/{chat_id}")
    assert deleted.json() == {"detail": "chat_cleared"}
    assert all(chat["id"] != chat_id for chat in (await client.get("/api/chats")).json())
    assert (await client.get(f"/api/chats/{chat_id}/messages")).json() == []
    # Writing again brings the conversation back into my own list.
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Снова тут"})
    revived = next(
        chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id
    )
    assert revived["last_message"] == "Снова тут"

    # The other side keeps the history a deletion took away from me.
    await client.post("/api/auth/logout")
    await login_as(client, "pinpal")
    theirs = next(
        chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id
    )
    assert theirs["pinned"] is False and theirs["archived"] is False
    assert [item["content"] for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()] == [
        "Привет",
        "Снова тут",
    ]


async def test_read_all_chats_clears_every_badge(client: AsyncClient) -> None:
    await register_partner(client, "reader")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/reader")).json()["id"]
    await client.post("/api/auth/logout")

    await login_as(client, "reader")
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Ты тут?"})
    await client.post("/api/auth/logout")

    await login_demo(client)
    mine = next(chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id)
    assert mine["unread_count"] >= 1
    assert (await client.post("/api/chats/read-all")).json() == {"detail": "chats_read"}
    assert all(chat["unread_count"] == 0 for chat in (await client.get("/api/chats")).json())


async def test_group_creation_naming_and_membership(client: AsyncClient) -> None:
    await login_demo(client)
    created = await client.post(
        "/api/chats/groups", json={"title": "Дизайн-бюро", "members": ["maya"]}
    )
    assert created.status_code == 201, created.text
    group = created.json()
    assert group["kind"] == "group" and group["is_group"] is True
    assert group["title"] == "Дизайн-бюро"
    assert group["members_count"] == 2
    # Creation announces itself in the thread, exactly as the reference does.
    assert group["last_message"] == "Группа «Дизайн-бюро» создана"

    renamed = await client.patch(f"/api/chats/{group['id']}", json={"title": "Дизайн-студия"})
    assert renamed.json()["title"] == "Дизайн-студия"

    added = await client.post(f"/api/chats/{group['id']}/members", json={"members": ["nikita"]})
    assert added.status_code == 200, added.text
    assert added.json()["members_count"] == 3

    info = (await client.get(f"/api/chats/{group['id']}/info")).json()
    assert [member["user"]["username"] for member in info["members"]] == [
        "leon",
        "maya",
        "nikita",
    ]
    assert next(member for member in info["members"] if member["user"]["username"] == "leon")[
        "is_owner"
    ] is True

    # Adding the same person twice is a conflict, not a silent duplicate.
    assert (
        await client.post(f"/api/chats/{group['id']}/members", json={"members": ["nikita"]})
    ).status_code == 409
    assert (
        await client.post("/api/chats/groups", json={"title": "Пустая", "members": ["leon"]})
    ).status_code == 400

    left = await client.delete(f"/api/chats/{group['id']}/members/nikita")
    assert left.json() == {"detail": "member_removed"}
    assert (await client.get(f"/api/chats/{group['id']}/info")).json()["chat"][
        "members_count"
    ] == 2

    # A group cannot be renamed by an outsider, and a direct chat cannot be renamed at all.
    direct_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    assert (await client.patch(f"/api/chats/{direct_id}", json={"title": "Нет"})).status_code == 409


async def test_secret_and_saved_chats_are_their_own_conversations(client: AsyncClient) -> None:
    await login_demo(client)
    direct_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    secret = await client.post("/api/chats/secret/maya")
    assert secret.status_code == 200, secret.text
    assert secret.json()["kind"] == "secret"
    # A secret chat never folds into the existing direct one.
    assert secret.json()["id"] != direct_id
    assert (await client.post("/api/chats/secret/maya")).json()["id"] == secret.json()["id"]
    assert (await client.post("/api/chats/secret/leon")).status_code == 400

    saved = await client.post("/api/chats/saved")
    assert saved.status_code == 200, saved.text
    assert saved.json()["kind"] == "saved"
    assert saved.json()["title"] == "Избранное"
    assert saved.json()["peer"] is None
    assert (await client.post("/api/chats/saved")).json()["id"] == saved.json()["id"]

    noted = await client.post(
        f"/api/chats/{saved.json()['id']}/messages", json={"content": "Запомнить: unixgram.com/x"}
    )
    assert noted.status_code == 201, noted.text
    info = (await client.get(f"/api/chats/{saved.json()['id']}/info")).json()
    # The info panel's links tab reads real URLs out of the thread.
    assert [link["url"] for link in info["links"]] == ["unixgram.com/x"]
    assert info["messages_count"] == 1


async def test_read_receipts_light_up_only_after_the_peer_reads(client: AsyncClient) -> None:
    """One tick until the other side opens the chat, two after."""
    await register_partner(client, "ticks")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/ticks")).json()["id"]
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Прочитай"})
    mine = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert [item["read"] for item in mine] == [False]

    await client.post("/api/auth/logout")
    await login_as(client, "ticks")
    theirs = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    # The reader's own view never shows ticks on someone else's message.
    assert [item["read"] for item in theirs] == [False]
    await client.post("/api/auth/logout")

    await login_demo(client)
    assert [item["read"] for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()] == [
        True
    ]
    # A message sent after they last read stays on one tick.
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "И это"})
    assert [item["read"] for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()] == [
        True,
        False,
    ]


async def test_group_gift_can_be_claimed_by_the_first_member(client: AsyncClient) -> None:
    """A drop belongs to nobody until someone takes it, and only one person can."""
    await register_partner(client, "taker")
    await register_partner(client, "rival")
    await login_demo(client)
    group = (
        await client.post("/api/chats/groups", json={"title": "Розыгрыш", "members": ["taker", "rival"]})
    ).json()
    catalog = (await client.get("/api/gifts/catalog")).json()
    affordable = next(item for item in catalog if not item["sold_out"])

    dropped = await client.post(
        f"/api/chats/{group['id']}/gifts", json={"slug": affordable["slug"], "claimable": True}
    )
    assert dropped.status_code == 201, dropped.text
    card = dropped.json()
    assert card["gift_claimable"] is True
    assert card["gift_claimed_by"] is None
    assert "забрать" in card["content"]

    claim = f"/api/chats/{group['id']}/messages/{card['id']}/claim-gift"
    # The person who paid for it cannot also take it.
    assert (await client.post(claim)).status_code == 400

    await client.post("/api/auth/logout")
    await login_as(client, "taker")
    taken = await client.post(claim)
    assert taken.status_code == 200, taken.text
    assert taken.json()["gift_claimed_by"]["username"] == "taker"
    assert taken.json()["gift_claimable"] is False
    mine = (await client.get("/api/gifts")).json()
    assert any(gift["id"] == card["gift"]["id"] for gift in mine)
    await client.post("/api/auth/logout")

    # Second claimant loses the race.
    await login_as(client, "rival")
    assert (await client.post(claim)).status_code == 409

    # An open drop makes no sense in a direct chat.
    await client.post("/api/auth/logout")
    await login_demo(client)
    direct_id = (await client.post("/api/chats/direct/taker")).json()["id"]
    assert (
        await client.post(
            f"/api/chats/{direct_id}/gifts", json={"slug": affordable["slug"], "claimable": True}
        )
    ).status_code == 409
    # Addressed to a member instead: that lands straight in their collection.
    addressed = await client.post(
        f"/api/chats/{group['id']}/gifts",
        json={"slug": affordable["slug"], "to_username": "rival"},
    )
    assert addressed.status_code == 201, addressed.text
    assert addressed.json()["gift_claimable"] is False
    info = (await client.get(f"/api/chats/{group['id']}/info")).json()
    # Gifts have their own shelf in the info panel, apart from attachments.
    assert len(info["gifts"]) == 2


async def test_socket_frames_carry_no_viewer_state(client: AsyncClient) -> None:
    """
    A broadcast reaches every member, so it must not describe one of them.

    `is_mine` and `read` in a shared frame made an incoming message render as the reader's
    own, which is the whole reason the payload is neutralised.
    """
    from app.main import broadcast_payload

    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/maya")).json()["id"]
    sent = await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Кому это?"})
    assert sent.status_code == 201, sent.text
    # The author's own view says the message is theirs...
    assert sent.json()["is_mine"] is True

    react = f"/api/chats/{chat_id}/messages/{sent.json()['id']}/reactions"
    reacted = await client.post(react, json={"emoji": "🔥"})
    assert reacted.json()["reactions"][0]["mine"] is True

    # ...but the frame that goes out to everyone claims nothing about the reader.
    from app.schemas import ChatMessage

    frame = broadcast_payload(ChatMessage.model_validate(reacted.json()))
    assert frame["is_mine"] is False
    assert frame["read"] is False
    assert [item["mine"] for item in frame["reactions"]] == [False]
    # Everything else survives, so the client can still render the message from the frame.
    assert frame["content"] == "Кому это?"
    assert frame["sender"]["username"] == "leon"


async def test_gift_art_proxy_caches_lottie_and_refuses_unknown_names(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    The artwork proxy fetches once, then serves the cache, and only for known designs.

    The download is stubbed so the suite stays offline. What is asserted is the contract the
    browser depends on: a `.tgs` arrives as gzip-encoded JSON, so no client-side decompression
    library is needed, and a second request costs no outbound call.
    """
    payload = gzip.compress(json.dumps({"v": "5.5.2", "fr": 60, "layers": []}).encode())
    calls: list[str] = []

    def fake_download(url: str) -> bytes:
        calls.append(url)
        return payload

    monkeypatch.setattr(giftart, "ART_ROOT", tmp_path / "giftart")
    monkeypatch.setattr(giftart, "_download", fake_download)
    await login_demo(client)

    first = await client.get("/api/gifts/art/original/vintage-cigar")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"].startswith("application/json")
    assert first.headers["content-encoding"] == "gzip"
    # httpx inflates it for us, which is exactly what a browser does with these headers.
    assert first.json()["fr"] == 60
    assert len(calls) == 1

    again = await client.get("/api/gifts/art/original/vintage-cigar")
    assert again.status_code == 200
    assert len(calls) == 1, "a cached asset must not be fetched twice"

    model = await client.get("/api/gifts/art/model/vintage-cigar/spectral-smoke")
    assert model.status_code == 200
    assert "Spectral%20Smoke" in calls[-1]

    # Only names present in the imported catalogue reach the network or the cache path.
    assert (await client.get("/api/gifts/art/original/not-a-real-gift")).status_code == 404
    assert (
        await client.get("/api/gifts/art/model/vintage-cigar/..%2f..%2fetc%2fpasswd")
    ).status_code == 404
    assert (
        await client.get("/api/gifts/art/original/vintage-cigar?ext=png&size=999")
    ).status_code == 400
    assert len(calls) == 2


async def test_buying_a_run_of_serials_charges_once_per_item(client: AsyncClient) -> None:
    """A run is several real items, each numbered and rolled on its own."""
    await login_demo(client)
    await client.post("/api/stars/top-up", json={"amount": 4000})
    design = (await client.get("/api/gifts/catalog/toy-bear")).json()
    before = (await client.get("/api/stars/wallet")).json()["balance"]

    bought = await client.post("/api/gifts/purchase", json={"slug": "toy-bear", "quantity": 4})
    assert bought.status_code == 201, bought.text
    body = bought.json()
    assert len(body["gifts"]) == 4
    assert body["spent_stars"] == design["price_stars"] * 4
    serials = [item["serial_number"] for item in body["gifts"]]
    # Four consecutive serials, not one item counted four times.
    assert len(set(serials)) == 4
    assert sorted(serials) == list(range(min(serials), min(serials) + 4))
    assert {item["owner_username"] for item in body["gifts"]} == {"leon"}
    wallet = (await client.get("/api/stars/wallet")).json()
    assert wallet["balance"] == before - design["price_stars"] * 4
    refreshed = (await client.get("/api/gifts/catalog/toy-bear")).json()
    assert refreshed["minted"] == design["minted"] + 4

    # A run beyond the per-request ceiling is refused rather than silently trimmed.
    too_many = await client.post(
        "/api/gifts/purchase", json={"slug": "toy-bear", "quantity": 99}
    )
    assert too_many.status_code == 422


async def test_owner_can_hide_a_gift_from_their_public_collection(client: AsyncClient) -> None:
    """Hiding curates the profile without giving up the item."""
    await login_demo(client)
    owned = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    gift = owned[0]
    assert gift["hidden_in_profile"] is False

    # Pinned first, so hiding has something to release.
    await client.patch("/api/users/me/showcase", json={"featured_gift_id": gift["id"]})
    hidden = await client.patch(f"/api/gifts/{gift['id']}/visibility", json={"hidden": True})
    assert hidden.status_code == 200, hidden.text
    assert hidden.json()["hidden_in_profile"] is True
    assert (await client.get("/api/users/leon")).json()["featured_gift"] is None
    # The owner still sees it, flagged, and it keeps its provenance.
    mine = {item["id"]: item for item in (await client.get("/api/gifts?owner=leon")).json()}
    assert mine[gift["id"]]["hidden_in_profile"] is True

    await client.post("/api/auth/logout")
    registered = await client.post(
        "/api/auth/register",
        json={"email": "viewer@gram.local", "password": "Viewer!2026", "username": "viewer"},
    )
    assert registered.status_code == 201, registered.text
    visible = {item["id"] for item in (await client.get("/api/gifts?owner=leon")).json()}
    assert gift["id"] not in visible
    # Only the owner may change it.
    assert (
        await client.patch(f"/api/gifts/{gift['id']}/visibility", json={"hidden": False})
    ).status_code == 403

    await client.post("/api/auth/logout")
    await login_demo(client)
    shown = await client.patch(f"/api/gifts/{gift['id']}/visibility", json={"hidden": False})
    assert shown.json()["hidden_in_profile"] is False


async def test_catalogue_designs_are_real_telegram_gifts(client: AsyncClient) -> None:
    """Every design is an imported Telegram gift with its own real variant pools."""
    await login_demo(client)
    catalog = (await client.get("/api/gifts/catalog")).json()
    assert len(catalog) == len(giftart.GIFTS) == 120
    known = {gift.slug for gift in giftart.GIFTS}
    assert {model["slug"] for model in catalog} <= known
    # No design carries a bitmap URL: artwork is served through the proxy instead.
    assert all(model["image_url"] is None for model in catalog)

    design = (await client.get("/api/gifts/catalog/vintage-cigar")).json()
    source = giftart.BY_SLUG["vintage-cigar"]
    assert len(design["models"]) == len(source.models)
    assert len(design["backdrops"]) == len(source.backdrops)
    assert len(design["symbols"]) == len(source.symbols)
    # Telegram publishes drop rates per mille, and each pool covers the whole distribution.
    assert round(sum(item["rarity_percent"] for item in design["models"])) == 100
    assert round(sum(item["rarity_percent"] for item in design["backdrops"])) == 100


async def test_deleting_an_account_frees_its_handle_for_reuse(client: AsyncClient) -> None:
    """
    A handle must come back when its owner leaves.

    `username_assets.owner_id` is ON DELETE SET NULL, so a deleted account used to leave the
    name RESERVED to nobody — and re-registering it crashed on the unique index instead of
    being accepted or refused cleanly.
    """
    created = await client.post(
        "/api/auth/register",
        json={"email": "recycle@gram.local", "password": "RecyclePass!2026", "username": "recycle"},
    )
    assert created.status_code == 201, created.text
    listed = (await client.get("/api/usernames")).json()
    assert any(item["username"] == "recycle" for item in listed)

    removed = await client.request(
        "DELETE", "/api/users/me", json={"password": "RecyclePass!2026"}
    )
    assert removed.json() == {"detail": "account_deleted"}

    # The freed name registers again rather than raising a unique violation.
    again = await client.post(
        "/api/auth/register",
        json={"email": "recycle2@gram.local", "password": "RecyclePass!2026", "username": "recycle"},
    )
    assert again.status_code == 201, again.text
    assert again.json()["user"]["username"] == "recycle"

    # And a handle someone still holds is refused with a status, not a crash.
    await client.post("/api/auth/logout")
    taken = await client.post(
        "/api/auth/register",
        json={"email": "recycle3@gram.local", "password": "RecyclePass!2026", "username": "recycle"},
    )
    assert taken.status_code == 409, taken.text


async def test_browser_holds_several_accounts_and_switches_without_a_password(
    client: AsyncClient,
) -> None:
    """
    Multi-account: a second sign-in parks the first, and switching back needs no password.

    The refresh tokens stay in httpOnly cookies, so the only thing the page ever sees is the
    roster and which entry is live.
    """
    await register_partner(client, "alto")
    await login_demo(client)
    first = (await client.get("/api/users/me")).json()
    assert first["username"] == "leon"

    # Signing into the second account keeps the first one on the device.
    await login_as(client, "alto")
    assert (await client.get("/api/users/me")).json()["username"] == "alto"
    slots = (await client.get("/api/auth/accounts")).json()
    assert {(item["user"]["username"], item["active"]) for item in slots} == {
        ("alto", True),
        ("leon", False),
    }

    # Switching back is one call and returns leon's own profile.
    switched = await client.post(f"/api/auth/accounts/{first['id']}/activate")
    assert switched.status_code == 200, switched.text
    assert switched.json()["user"]["username"] == "leon"
    assert (await client.get("/api/users/me")).json()["username"] == "leon"
    slots = (await client.get("/api/auth/accounts")).json()
    assert {(item["user"]["username"], item["active"]) for item in slots} == {
        ("leon", True),
        ("alto", False),
    }

    # A used slot cannot be replayed: the token behind it was rotated on the way in.
    assert (await client.post(f"/api/auth/accounts/{first['id']}/activate")).status_code == 404

    # Removing the parked account leaves the active one signed in.
    alto_id = next(item["user"]["id"] for item in slots if item["user"]["username"] == "alto")
    removed = await client.delete(f"/api/auth/accounts/{alto_id}")
    assert removed.json() == {"detail": "account_removed"}
    assert [item["user"]["username"] for item in (await client.get("/api/auth/accounts")).json()] == [
        "leon"
    ]
    assert (await client.get("/api/users/me")).json()["username"] == "leon"

    # Signing out drops the active account without touching the roster's other entries.
    await client.post("/api/auth/logout")
    assert (await client.get("/api/users/me")).status_code == 401
    assert (await client.get("/api/auth/accounts")).json() == []


async def test_switching_to_an_unknown_account_is_refused(client: AsyncClient) -> None:
    await login_demo(client)
    me = (await client.get("/api/users/me")).json()
    # The active account is not a parked slot, so it cannot be "switched" into.
    assert (await client.post(f"/api/auth/accounts/{me['id']}/activate")).status_code == 404
    assert (
        await client.post("/api/auth/accounts/00000000-0000-0000-0000-000000000000/activate")
    ).status_code == 404
    assert (
        await client.delete("/api/auth/accounts/00000000-0000-0000-0000-000000000000")
    ).status_code == 404


async def test_muting_a_chat_silences_notifications_but_keeps_the_badge(
    client: AsyncClient,
) -> None:
    """A muted conversation still counts, the way the reference mutes: badge yes, alert no."""
    await register_partner(client, "loudpal")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/loudpal")).json()["id"]

    await client.post("/api/auth/logout")
    await login_as(client, "loudpal")
    muted = await client.patch(f"/api/chats/{chat_id}/state", json={"muted": True})
    assert muted.status_code == 200, muted.text
    assert muted.json()["muted"] is True
    before = len((await client.get("/api/notifications")).json())

    await client.post("/api/auth/logout")
    await login_demo(client)
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Слышно?"})

    await client.post("/api/auth/logout")
    await login_as(client, "loudpal")
    assert len((await client.get("/api/notifications")).json()) == before
    listed = next(
        chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id
    )
    assert listed["muted"] is True
    assert listed["unread_count"] == 1

    # Unmuting restores the alert for whatever comes next.
    assert (
        await client.patch(f"/api/chats/{chat_id}/state", json={"muted": False})
    ).json()["muted"] is False
    await client.post("/api/auth/logout")
    await login_demo(client)
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "А теперь?"})
    await client.post("/api/auth/logout")
    await login_as(client, "loudpal")
    assert len((await client.get("/api/notifications")).json()) == before + 1


async def test_autodelete_clears_old_messages_and_spares_pins(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The window applies to the conversation, and a pin is a deliberate exception to it."""
    await register_partner(client, "fadepal")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/fadepal")).json()["id"]
    stale = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Старое"})
    ).json()
    kept = (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Закреплённое"})
    ).json()
    await client.post(f"/api/chats/{chat_id}/messages/{kept['id']}/pin")

    enabled = await client.patch(f"/api/chats/{chat_id}/autodelete", json={"seconds": 86400})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["autodelete_seconds"] == 86400
    # Turning it on is announced in the thread, as Telegram does.
    thread = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert any("включил(а) автоудаление" in item["content"] for item in thread)

    # Age both messages past the window; only the unpinned one should go.
    await db_session.execute(
        update(Message)
        .where(Message.chat_id == uuid.UUID(chat_id))
        .values(created_at=datetime.now(UTC) - timedelta(days=3))
    )
    await db_session.commit()

    remaining = [
        item["content"] for item in (await client.get(f"/api/chats/{chat_id}/messages")).json()
    ]
    assert "Старое" not in remaining
    assert "Закреплённое" in remaining
    assert stale["content"] == "Старое"

    # Off again, and nothing further is removed.
    off = await client.patch(f"/api/chats/{chat_id}/autodelete", json={"seconds": 0})
    assert off.json()["autodelete_seconds"] == 0
    odd = await client.patch(f"/api/chats/{chat_id}/autodelete", json={"seconds": 5})
    assert odd.status_code == 422


async def test_forwarding_copies_messages_and_names_their_author(client: AsyncClient) -> None:
    """A forward is a copy that remembers whose words it carries."""
    await register_partner(client, "sourcepal")
    await register_partner(client, "targetpal")
    await login_demo(client)
    source = (await client.post("/api/chats/direct/sourcepal")).json()["id"]
    target = (await client.post("/api/chats/direct/targetpal")).json()["id"]
    await client.post("/api/auth/logout")

    await login_as(client, "sourcepal")
    theirs = (
        await client.post(f"/api/chats/{source}/messages", json={"content": "Их слова"})
    ).json()
    await client.post("/api/auth/logout")

    await login_demo(client)
    forwarded = await client.post(
        f"/api/chats/{source}/messages/forward",
        json={"message_ids": [theirs["id"]], "chat_ids": [target]},
    )
    assert forwarded.status_code == 201, forwarded.text
    assert forwarded.json() == {"detail": "Переслано: 1"}

    copy = (await client.get(f"/api/chats/{target}/messages")).json()[-1]
    assert copy["content"] == "Их слова"
    assert copy["is_mine"] is True
    assert copy["forwarded_from"]["username"] == "sourcepal"

    # A forward out of a chat I am not in is not mine to make.
    await client.post("/api/auth/logout")
    await login_as(client, "targetpal")
    assert (
        await client.post(
            f"/api/chats/{source}/messages/forward",
            json={"message_ids": [theirs["id"]], "chat_ids": [target]},
        )
    ).status_code == 403


async def test_a_gift_card_can_be_neither_forwarded_nor_edited(client: AsyncClient) -> None:
    """One card, one collectible, one owner: a copy of it elsewhere would misstate who holds it."""
    await register_partner(client, "cardpal")
    await login_demo(client)
    catalog = (await client.get("/api/gifts/catalog")).json()
    affordable = next(item for item in catalog if not item["sold_out"])
    bought = await client.post(
        "/api/gifts/purchase", json={"slug": affordable["slug"], "to_username": "cardpal"}
    )
    assert bought.status_code in {200, 201}, bought.text

    source = (await client.post("/api/chats/direct/cardpal")).json()["id"]
    saved = (await client.post("/api/chats/saved")).json()["id"]
    card = next(
        item for item in (await client.get(f"/api/chats/{source}/messages")).json() if item["gift"]
    )
    refused = await client.post(
        f"/api/chats/{source}/messages/forward",
        json={"message_ids": [card["id"]], "chat_ids": [saved]},
    )
    assert refused.status_code == 409, refused.text
    assert "Подарки" in refused.json()["detail"]
    assert (await client.get(f"/api/chats/{saved}/messages")).json() == []

    edited = await client.patch(
        f"/api/chats/{source}/messages/{card['id']}", json={"content": "Другой подарок"}
    )
    assert edited.status_code == 409, edited.text

    # A gift alongside ordinary text does not block the rest of the selection.
    plain = (
        await client.post(f"/api/chats/{source}/messages", json={"content": "Обычная строка"})
    ).json()
    mixed = await client.post(
        f"/api/chats/{source}/messages/forward",
        json={"message_ids": [card["id"], plain["id"]], "chat_ids": [saved]},
    )
    assert mixed.status_code == 201, mixed.text
    assert mixed.json()["detail"] == "Переслано: 1 · часть пропущена"
    copies = (await client.get(f"/api/chats/{saved}/messages")).json()
    assert [item["content"] for item in copies] == ["Обычная строка"]
    assert copies[0]["gift"] is None


async def test_a_picture_travels_as_a_message_with_its_caption(
    client: AsyncClient, tmp_path: Path
) -> None:
    """An attachment is one message: the image and the words beside it arrive together."""
    await register_partner(client, "photopal")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/photopal")).json()["id"]

    picture = tmp_path / "shot.png"
    Image.new("RGB", (64, 48), "teal").save(picture)
    sent = await client.post(
        f"/api/chats/{chat_id}/messages/media",
        files={"file": ("shot.png", picture.read_bytes(), "image/png")},
        data={"caption": "Вечерний кадр"},
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["media_url"].startswith("/media/chats/")
    assert sent.json()["content"] == "Вечерний кадр"

    window = (await client.get(f"/api/chats/{chat_id}/messages")).json()
    assert window[-1]["media_url"] == sent.json()["media_url"]
    # The chat list has to say something about a picture that carries no caption.
    bare = await client.post(
        f"/api/chats/{chat_id}/messages/media",
        files={"file": ("shot.png", picture.read_bytes(), "image/png")},
    )
    assert bare.status_code == 201, bare.text
    assert bare.json()["content"] == ""

    # A forward carries the picture with it.
    saved = (await client.post("/api/chats/saved")).json()["id"]
    forwarded = await client.post(
        f"/api/chats/{chat_id}/messages/forward",
        json={"message_ids": [sent.json()["id"]], "chat_ids": [saved]},
    )
    assert forwarded.status_code == 201, forwarded.text
    copy = (await client.get(f"/api/chats/{saved}/messages")).json()[-1]
    assert copy["media_url"] == sent.json()["media_url"]

    # Anything that is not an image is refused, whatever its name claims.
    fake = await client.post(
        f"/api/chats/{chat_id}/messages/media",
        files={"file": ("payload.png", b"MZ not an image", "image/png")},
    )
    assert fake.status_code == 422, fake.text

    # A chat I am not in is not free file hosting.
    await client.post("/api/auth/logout")
    await register_partner(client, "outsider")
    await login_as(client, "outsider")
    denied = await client.post(
        f"/api/chats/{chat_id}/messages/media",
        files={"file": ("shot.png", picture.read_bytes(), "image/png")},
    )
    assert denied.status_code == 403, denied.text


async def test_blocking_closes_the_direct_chat_in_both_directions(client: AsyncClient) -> None:
    """A block stops the conversation from either side and drops the following with it."""
    await register_partner(client, "blockpal")
    await login_demo(client)
    chat_id = (await client.post("/api/chats/direct/blockpal")).json()["id"]
    await client.post("/api/users/blockpal/follow")
    await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Пока можно"})

    blocked = await client.post("/api/users/blockpal/block")
    assert blocked.status_code == 200, blocked.text
    profile = (await client.get("/api/users/blockpal")).json()
    assert profile["is_blocked"] is True
    assert profile["is_following"] is False

    refused = await client.post(f"/api/chats/{chat_id}/messages", json={"content": "И теперь?"})
    assert refused.status_code == 403
    assert (await client.post("/api/chats/direct/blockpal")).status_code == 403
    # The chat itself has to say so, or the closed conversation looks merely broken.
    mine = next(chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id)
    assert mine["peer_blocked"] is True
    assert mine["blocked_by_peer"] is False

    # The other side is stopped too, without having blocked anyone themselves.
    await client.post("/api/auth/logout")
    await login_as(client, "blockpal")
    assert (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Ответ"})
    ).status_code == 403
    assert (await client.get("/api/users/leon")).json()["is_blocked"] is False
    theirs = next(chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id)
    assert theirs["peer_blocked"] is False
    assert theirs["blocked_by_peer"] is True

    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.delete("/api/users/blockpal/block")).status_code == 200
    reopened = next(
        chat for chat in (await client.get("/api/chats")).json() if chat["id"] == chat_id
    )
    assert reopened["peer_blocked"] is False
    assert reopened["blocked_by_peer"] is False
    assert (
        await client.post(f"/api/chats/{chat_id}/messages", json={"content": "Снова можно"})
    ).status_code == 201
    assert (await client.post("/api/users/leon/block")).status_code == 400


async def test_settings_hide_presence_close_the_account_and_silence_kinds(
    client: AsyncClient,
) -> None:
    """Each switch has to change what another account actually sees or receives."""
    await register_partner(client, "watcher")
    await login_demo(client)
    defaults = await client.get("/api/users/me/settings")
    assert defaults.status_code == 200, defaults.text
    assert defaults.json()["show_online"] is True
    assert defaults.json()["private_account"] is False

    saved = await client.patch(
        "/api/users/me/settings",
        json={
            "show_online": False,
            "private_account": True,
            "notify_likes": False,
            "status_emoji": "🌙",
            "status_text": "  сплю  ",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["show_online"] is False
    # A padded status is stored trimmed, and an emptied one clears rather than becoming "".
    assert saved.json()["status_text"] == "сплю"
    assert (await client.patch("/api/users/me/settings", json={"status_text": "  "})).json()[
        "status_text"
    ] is None
    # One switch must not reset another.
    assert (await client.get("/api/users/me/settings")).json()["private_account"] is True

    post_id = (
        await client.post("/api/feed", json={"content": "Только для подписчиков"})
    ).json()["id"]
    mine = await client.get("/api/users/leon")
    assert mine.json()["presence_hidden"] is True
    # My own view keeps my presence: the switch is about other people.
    assert mine.json()["is_online"] is True

    await client.post("/api/auth/logout")
    await login_as(client, "watcher")
    seen = await client.get("/api/users/leon")
    assert seen.status_code == 200
    assert seen.json()["is_online"] is False
    assert seen.json()["last_seen_at"] is None
    assert seen.json()["presence_hidden"] is True
    assert seen.json()["status_emoji"] == "🌙"
    assert seen.json()["is_private"] is True
    assert seen.json()["can_view_content"] is False

    # The profile stays readable; its content does not.
    assert (await client.get("/api/feed", params={"author": "leon"})).status_code == 403
    assert (await client.get("/api/users/leon/stories")).status_code == 403
    assert (await client.get("/api/users/leon/replies")).status_code == 403

    # A closed account is asked, not entered: the content stays shut until it answers.
    asked = await client.post("/api/users/leon/follow")
    assert asked.status_code == 200, asked.text
    assert asked.json()["requested"] is True
    assert (await client.get("/api/users/leon")).json()["can_view_content"] is False

    # A muted kind stops reaching the list it was muted from.
    liked = await client.post(f"/api/feed/{post_id}/like")
    assert liked.status_code == 200, liked.text
    await client.post("/api/auth/logout")
    await login_demo(client)
    kinds = {item["kind"] for item in (await client.get("/api/notifications")).json()}
    assert "like" not in kinds
    assert (await client.patch("/api/users/me/settings", json={"notify_likes": True})).json()[
        "notify_likes"
    ] is True
    kinds = {item["kind"] for item in (await client.get("/api/notifications")).json()}
    assert "like" in kinds


async def test_post_views_are_recorded_reads_not_a_formula(client: AsyncClient) -> None:
    """A post nobody opened has no views, and one reader twice is one reader."""
    await register_partner(client, "reader")
    await login_demo(client)
    post = (await client.post("/api/feed", json={"content": "Считаем просмотры"})).json()
    assert post["views_count"] == 0
    assert post["unique_views_count"] == 0
    assert post["viewed_by_me"] is False

    first = await client.post(f"/api/feed/{post['id']}/view")
    assert first.status_code == 200, first.text
    assert first.json() == {"recorded": True, "views_count": 1, "unique_views_count": 1}
    # The same reader again raises the total, not the number of people.
    again = await client.post(f"/api/feed/{post['id']}/view")
    assert again.json() == {"recorded": False, "views_count": 2, "unique_views_count": 1}

    await client.post("/api/auth/logout")
    await login_as(client, "reader")
    theirs = await client.post(f"/api/feed/{post['id']}/view")
    assert theirs.json() == {"recorded": True, "views_count": 3, "unique_views_count": 2}

    await client.post("/api/auth/logout")
    await login_demo(client)
    listed = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == post["id"]
    )
    assert listed["views_count"] == 3
    assert listed["unique_views_count"] == 2
    assert listed["viewed_by_me"] is True
    assert (
        await client.post("/api/feed/00000000-0000-0000-0000-000000000000/view")
    ).status_code == 404


def test_soundcloud_links_are_found_in_ordinary_text() -> None:
    """The scan has to survive punctuation, the share shortener and neighbouring words."""
    from app import music

    assert music.find_link("послушайте https://soundcloud.com/artist/track вот") == (
        "https://soundcloud.com/artist/track"
    )
    assert music.find_link("https://on.soundcloud.com/Md85BpmxlMq03VzIKv.") == (
        "https://on.soundcloud.com/Md85BpmxlMq03VzIKv"
    )
    assert music.find_link("ничего тут нет") is None
    assert music.find_link("") is None


async def test_a_pasted_music_link_becomes_a_card_on_the_post(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Resolution is mocked; what matters is that the card is stored and served."""
    from app import music

    def fake_resolve(url: str) -> dict[str, object]:
        return {
            "title": "пролетая этажи",
            "artist": "TimArh",
            "cover_url": "https://i1.sndcdn.com/artworks-x-t500x500.jpg",
            "provider": "soundcloud",
            "external_url": url,
            "external_id": "1813720305",
        }

    monkeypatch.setattr(music, "resolve", fake_resolve)
    await login_demo(client)
    created = await client.post(
        "/api/feed",
        json={"content": "gn https://on.soundcloud.com/Md85BpmxlMq03VzIKv"},
    )
    assert created.status_code == 201, created.text
    card = created.json()["music"]
    assert card["title"] == "пролетая этажи"
    assert card["artist"] == "TimArh"
    assert card["provider"] == "soundcloud"
    assert card["external_url"].endswith("Md85BpmxlMq03VzIKv")

    listed = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == created.json()["id"]
    )
    assert listed["music"]["cover_url"].endswith("t500x500.jpg")

    # A post without a link carries no card, and a dead link does not block publishing.
    plain = await client.post("/api/feed", json={"content": "просто текст"})
    assert plain.json()["music"] is None
    monkeypatch.setattr(music, "resolve", lambda url: None)
    dead = await client.post(
        "/api/feed", json={"content": "https://soundcloud.com/nope/nothing"}
    )
    assert dead.status_code == 201
    assert dead.json()["music"] is None


async def test_a_post_carries_up_to_four_uploaded_pictures(
    client: AsyncClient, tmp_path: Path
) -> None:
    """Pictures are uploaded first, then published together with the text."""
    await login_demo(client)
    shot = tmp_path / "frame.png"
    Image.new("RGB", (80, 60), "indigo").save(shot)

    urls: list[str] = []
    for _ in range(5):
        uploaded = await client.post(
            "/api/feed/media", files={"file": ("frame.png", shot.read_bytes(), "image/png")}
        )
        assert uploaded.status_code == 201, uploaded.text
        assert uploaded.json()["url"].startswith("/media/posts/")
        urls.append(uploaded.json()["url"])

    created = await client.post(
        "/api/feed", json={"content": "Четыре кадра", "image_urls": urls[:4]}
    )
    assert created.status_code == 201, created.text
    assert created.json()["image_urls"] == urls[:4]
    # The first picture stays in `image_url`, which is what older readers of a post expect.
    assert created.json()["image_url"] == urls[0]

    listed = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == created.json()["id"]
    )
    assert listed["image_urls"] == urls[:4]

    # Five is one too many.
    assert (
        await client.post("/api/feed", json={"content": "Пять", "image_urls": urls})
    ).status_code == 422

    # A post with only a picture is still a post, and a text-only one has an empty gallery.
    only_text = await client.post("/api/feed", json={"content": "без картинок"})
    assert only_text.json()["image_urls"] == []
    # Anything that is not an image is refused before it reaches a post.
    fake = await client.post(
        "/api/feed/media", files={"file": ("x.png", b"not an image at all", "image/png")}
    )
    assert fake.status_code == 422


async def test_comments_can_be_liked_edited_answered_and_sorted(client: AsyncClient) -> None:
    """A thread is not a flat list: it has likes, replies, edits and three orders."""
    await register_partner(client, "commenter")
    await login_demo(client)
    post = (await client.post("/api/feed", json={"content": "Обсудим"})).json()
    mine = (
        await client.post(f"/api/feed/{post['id']}/comments", json={"content": "Первый"})
    ).json()
    assert mine["likes_count"] == 0
    assert mine["can_edit"] is True
    assert mine["can_delete"] is True
    assert mine["parent_id"] is None

    edited = await client.patch(
        f"/api/feed/{post['id']}/comments/{mine['id']}", json={"content": "Первый, но лучше"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"] == "Первый, но лучше"
    assert edited.json()["edited_at"] is not None

    await client.post("/api/auth/logout")
    await login_as(client, "commenter")
    # Somebody else may answer and may like, but may not rewrite my words.
    reply = await client.post(
        f"/api/feed/{post['id']}/comments",
        json={"content": "Ответ на первый", "parent_id": mine["id"]},
    )
    assert reply.status_code == 201, reply.text
    assert reply.json()["parent_id"] == mine["id"]
    assert (
        await client.patch(
            f"/api/feed/{post['id']}/comments/{mine['id']}", json={"content": "Подмена"}
        )
    ).status_code == 403
    liked = await client.post(f"/api/feed/{post['id']}/comments/{mine['id']}/like")
    assert liked.status_code == 200, liked.text
    assert liked.json()["likes_count"] == 1
    assert liked.json()["liked_by_me"] is True
    # The same like again clears it.
    assert (
        await client.post(f"/api/feed/{post['id']}/comments/{mine['id']}/like")
    ).json()["likes_count"] == 0
    await client.post(f"/api/feed/{post['id']}/comments/{mine['id']}/like")

    await client.post("/api/auth/logout")
    await login_demo(client)
    thread = (await client.get(f"/api/feed/{post['id']}/comments")).json()
    root = next(item for item in thread if item["id"] == mine["id"])
    assert root["replies_count"] == 1
    assert root["likes_count"] == 1
    # The post's author moderates the thread, so a stranger's comment is theirs to remove.
    assert next(item for item in thread if item["id"] == reply.json()["id"])["can_delete"] is True

    newest = (await client.get(f"/api/feed/{post['id']}/comments", params={"sort": "new"})).json()
    oldest = (await client.get(f"/api/feed/{post['id']}/comments", params={"sort": "old"})).json()
    assert newest[0]["id"] == reply.json()["id"]
    assert oldest[0]["id"] == mine["id"]
    top = (await client.get(f"/api/feed/{post['id']}/comments", params={"sort": "top"})).json()
    assert top[0]["id"] == mine["id"]
    assert (
        await client.get(f"/api/feed/{post['id']}/comments", params={"sort": "sideways"})
    ).status_code == 422

    removed = await client.delete(f"/api/feed/{post['id']}/comments/{mine['id']}")
    assert removed.status_code == 200, removed.text
    # Deleting a root takes its replies with it.
    assert (await client.get(f"/api/feed/{post['id']}/comments")).json() == []


async def test_a_post_can_carry_one_outbound_link(client: AsyncClient) -> None:
    """The card is the author's own choice, and only http(s) is allowed into it."""
    await login_demo(client)
    created = await client.post(
        "/api/feed",
        json={
            "content": "смотрите проект",
            "link_url": "https://example.com/project?ref=gram",
            "link_title": "Наш проект",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["link_url"] == "https://example.com/project?ref=gram"
    assert created.json()["link_title"] == "Наш проект"

    listed = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == created.json()["id"]
    )
    assert listed["link_url"].startswith("https://example.com")

    # A script URL in a card would be an attack surface, so it is refused outright.
    for bad in ["javascript:alert(1)", "data:text/html,<script>", "ftp://files.example.com"]:
        refused = await client.post("/api/feed", json={"content": "нет", "link_url": bad})
        assert refused.status_code == 422, bad
    blank = await client.post("/api/feed", json={"content": "без ссылки", "link_url": "  "})
    assert blank.status_code == 201
    assert blank.json()["link_url"] is None


async def test_a_channel_has_its_own_stories_and_owner_settings(client: AsyncClient) -> None:
    """A channel publishes as itself: its stories and its settings belong to its owner."""
    await login_demo(client)
    created = await client.post(
        "/api/communities",
        json={"slug": "night-shift", "title": "Ночная смена", "description": "Про тишину"},
    )
    assert created.status_code == 201, created.text

    story = await client.post(
        "/api/users/me/stories",
        json={
            "title": "Первая история канала",
            "media_url": "https://example.com/story.jpg",
            "community_slug": "night-shift",
        },
    )
    assert story.status_code == 201, story.text
    channel_stories = await client.get("/api/communities/night-shift/stories")
    assert channel_stories.status_code == 200
    assert [item["title"] for item in channel_stories.json()] == ["Первая история канала"]
    # A channel story stays off its author's own profile.
    assert all(
        item["title"] != "Первая история канала"
        for item in (await client.get("/api/users/leon/stories")).json()
    )

    settings = await client.patch(
        "/api/communities/night-shift",
        json={"title": "Ночная смена 2", "location": "Киев", "description": ""},
    )
    assert settings.status_code == 200, settings.text
    assert settings.json()["title"] == "Ночная смена 2"
    assert settings.json()["location"] == "Киев"
    # An emptied field clears rather than storing an empty string.
    assert settings.json()["description"] in {None, ""}

    # Somebody else can neither publish the channel's stories nor change its settings.
    await register_partner(client, "outsider2")
    await login_as(client, "outsider2")
    assert (
        await client.post(
            "/api/users/me/stories",
            json={
                "title": "Чужая история",
                "media_url": "https://example.com/x.jpg",
                "community_slug": "night-shift",
            },
        )
    ).status_code == 403
    assert (
        await client.patch("/api/communities/night-shift", json={"title": "Моё теперь"})
    ).status_code == 403
    # The stories themselves stay readable to anyone who can see the channel.
    assert len((await client.get("/api/communities/night-shift/stories")).json()) == 1


async def test_a_post_can_be_rewritten_and_pinned_by_its_author(client: AsyncClient) -> None:
    """Editing keeps the post and marks it; pinning moves it to the top of the author's page."""
    await register_partner(client, "stranger")
    await login_demo(client)
    first = (await client.post("/api/feed", json={"content": "Первый"})).json()
    second = (
        await client.post(
            "/api/feed", json={"content": "Второй", "link_url": "https://example.com"}
        )
    ).json()
    assert first["edited_at"] is None
    assert first["is_pinned"] is False
    assert first["can_edit"] is True

    edited = await client.patch(
        f"/api/feed/{first['id']}",
        json={"content": "Первый, но лучше", "link_url": "https://gram.local/manifesto"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"] == "Первый, но лучше"
    assert edited.json()["link_url"] == "https://gram.local/manifesto"
    assert edited.json()["edited_at"] is not None
    # A rewrite keeps the post: same id, same place in the counters.
    assert edited.json()["id"] == first["id"]
    # Clearing the field removes the card rather than leaving the old link behind.
    cleared = await client.patch(f"/api/feed/{second['id']}", json={"content": "Второй"})
    assert cleared.json()["link_url"] is None
    assert (
        await client.patch(f"/api/feed/{first['id']}", json={"content": "  "})
    ).status_code == 422
    assert (
        await client.patch(
            f"/api/feed/{first['id']}",
            json={"content": "Опасно", "link_url": "javascript:alert(1)"},
        )
    ).status_code == 422

    pinned = await client.post(f"/api/feed/{first['id']}/pin")
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["is_pinned"] is True
    page = (await client.get("/api/feed", params={"author": "leon"})).json()
    assert page[0]["id"] == first["id"]
    # Pinning another post moves the pin rather than keeping two.
    await client.post(f"/api/feed/{second['id']}/pin")
    page = (await client.get("/api/feed", params={"author": "leon"})).json()
    assert page[0]["id"] == second["id"]
    assert next(item for item in page if item["id"] == first["id"])["is_pinned"] is False
    assert (await client.delete(f"/api/feed/{second['id']}/pin")).json()["is_pinned"] is False

    await client.post("/api/auth/logout")
    await login_as(client, "stranger")
    assert (
        await client.patch(f"/api/feed/{first['id']}", json={"content": "Не моё"})
    ).status_code == 403
    assert (await client.post(f"/api/feed/{first['id']}/pin")).status_code == 403


async def test_muting_a_post_silences_its_notifications_only(client: AsyncClient) -> None:
    """A comment and a like reach the author — until the author mutes that one post."""
    await register_partner(client, "commenter")
    await login_demo(client)
    loud = (await client.post("/api/feed", json={"content": "Обсуждаемое"})).json()
    quiet = (await client.post("/api/feed", json={"content": "Тихое"})).json()
    muted = await client.post(f"/api/feed/{quiet['id']}/mute")
    assert muted.status_code == 200, muted.text
    assert (await client.get(f"/api/feed/{quiet['id']}")).json()["is_muted"] is True
    assert (await client.get(f"/api/feed/{loud['id']}")).json()["is_muted"] is False

    await client.post("/api/auth/logout")
    await login_as(client, "commenter")
    for post in (loud, quiet):
        assert (
            await client.post(f"/api/feed/{post['id']}/comments", json={"content": "Хорошо"})
        ).status_code == 201
        assert (await client.post(f"/api/feed/{post['id']}/like")).status_code == 200

    await client.post("/api/auth/logout")
    await login_demo(client)
    about = [
        item
        for item in (await client.get("/api/notifications")).json()
        if item["entity_id"] in {loud["id"], quiet["id"]}
    ]
    assert {item["entity_id"] for item in about} == {loud["id"]}
    assert {item["kind"] for item in about} == {"comment", "like"}
    # Unmuting brings the next one back; the mute never touched the counters.
    assert (await client.delete(f"/api/feed/{quiet['id']}/mute")).status_code == 200
    assert (await client.get(f"/api/feed/{quiet['id']}")).json()["comments_count"] == 1


async def test_a_complaint_about_a_post_is_one_row_per_person(client: AsyncClient) -> None:
    """A report is stored, replaced when repeated, and refused on one's own writing."""
    await login_demo(client)
    mine = (await client.post("/api/feed", json={"content": "Моя запись"})).json()
    assert (
        await client.post(f"/api/feed/{mine['id']}/report", json={"reason": "spam"})
    ).status_code == 400

    await register_partner(client, "watchdog")
    await login_as(client, "watchdog")
    theirs = (await client.get("/api/feed")).json()[0]
    first = await client.post(
        f"/api/feed/{theirs['id']}/report", json={"reason": "spam", "comment": "Реклама"}
    )
    assert first.status_code == 201, first.text
    assert first.json()["detail"] == "Жалоба отправлена"
    again = await client.post(f"/api/feed/{theirs['id']}/report", json={"reason": "fraud"})
    assert again.status_code == 201, again.text
    assert (
        await client.post(f"/api/feed/{theirs['id']}/report", json={"reason": "не знаю"})
    ).status_code == 422


async def test_a_name_slot_gift_travels_with_its_owner_into_the_feed(
    client: AsyncClient,
) -> None:
    """The emblem beside a name is the gift in the name slot, wherever that name appears."""
    await login_demo(client)
    gifts = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    post = (await client.post("/api/feed", json={"content": "С подарком у имени"})).json()
    assert post["author"]["name_gift"] is None

    # The marker beside the name comes with Premium, so the account buys it first.
    await client.post("/api/stars/top-up", json={"amount": 1000})
    assert (await client.post("/api/premium/purchase", json={"plan": "monthly"})).status_code == 200
    named = await client.patch("/api/users/me/showcase", json={"name_gift_id": gifts[1]["id"]})
    assert named.status_code == 200, named.text
    listed = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == post["id"]
    )
    assert listed["author"]["name_gift"]["id"] == gifts[1]["id"]
    assert listed["author"]["name_gift"]["name"] == gifts[1]["name"]
    # A comment carries it too: the marker belongs to the person, not to the surface.
    commented = await client.post(f"/api/feed/{post['id']}/comments", json={"content": "И тут"})
    assert commented.json()["author"]["name_gift"]["id"] == gifts[1]["id"]


async def test_stars_can_support_one_post_and_the_card_counts_them(client: AsyncClient) -> None:
    """Support aimed at a post is counted on that post and notifies about that post."""
    await register_partner(client, "patron")
    await login_demo(client)
    post = (await client.post("/api/feed", json={"content": "Поддержите эту запись"})).json()
    assert post["stars_count"] == 0
    assert post["starred_by_me"] is False

    await client.post("/api/auth/logout")
    await login_as(client, "patron")
    await client.post("/api/stars/top-up", json={"amount": 500})
    sent = await client.post(
        "/api/stars/send",
        json={"to_username": "leon", "amount": 40, "post_id": post["id"]},
    )
    assert sent.status_code == 200, sent.text
    seen = (await client.get(f"/api/feed/{post['id']}")).json()
    assert seen["stars_count"] == 40
    assert seen["starred_by_me"] is True
    # Supporting it again adds up rather than replacing the previous gift.
    await client.post(
        "/api/stars/send", json={"to_username": "leon", "amount": 10, "post_id": post["id"]}
    )
    assert (await client.get(f"/api/feed/{post['id']}")).json()["stars_count"] == 50
    # The post has to belong to the person being supported.
    mine = (await client.post("/api/feed", json={"content": "Моя же запись"})).json()
    assert (
        await client.post(
            "/api/stars/send",
            json={"to_username": "leon", "amount": 5, "post_id": mine["id"]},
        )
    ).status_code == 400

    await client.post("/api/auth/logout")
    await login_demo(client)
    notice = next(
        item
        for item in (await client.get("/api/notifications")).json()
        if item["kind"] == "stars" and item["entity_id"] == post["id"]
    )
    assert "поддержал" in notice["text"]
    # The author sees the tally but is not offered to support themselves.
    assert (await client.get(f"/api/feed/{post['id']}")).json()["starred_by_me"] is False


async def test_a_pinned_gift_leads_the_collection(client: AsyncClient) -> None:
    """Pinning is about order: a pinned item comes first however old it is."""
    await login_demo(client)
    gifts = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    assert len(gifts) >= 2
    last = gifts[-1]
    assert last["is_pinned"] is False

    pinned = await client.post(f"/api/gifts/{last['id']}/pin")
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["is_pinned"] is True
    listed = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    assert listed[0]["id"] == last["id"]
    # Pinning a hidden item brings it back: a pin nobody can see would promise nothing.
    await client.patch(f"/api/gifts/{last['id']}/visibility", json={"hidden": True})
    assert (await client.post(f"/api/gifts/{last['id']}/pin")).json()["hidden_in_profile"] is False
    assert (await client.delete(f"/api/gifts/{last['id']}/pin")).json()["is_pinned"] is False
    assert (await client.get("/api/gifts", params={"owner": "leon"})).json()[0]["id"] != last["id"]

    await register_partner(client, "envious")
    await login_as(client, "envious")
    assert (await client.post(f"/api/gifts/{last['id']}/pin")).status_code == 403


async def test_a_profile_may_only_feature_its_own_community(client: AsyncClient) -> None:
    """Someone else's community on your page would be an endorsement nobody gave."""
    await login_demo(client)
    mine = await client.post(
        "/api/communities",
        json={
            "name": "Своё сообщество",
            "title": "Своё сообщество",
            "slug": "my-own-place",
            "description": "Про своё",
        },
    )
    assert mine.status_code == 201, mine.text
    only_mine = await client.get("/api/communities", params={"mine": "true"})
    slugs = {item["slug"] for item in only_mine.json()}
    assert "my-own-place" in slugs
    # Everything the picker offers is this account's own, seeded channels included.
    assert all(item["is_owner"] for item in only_mine.json())

    assert (
        await client.patch("/api/users/me", json={"featured_community_slug": "my-own-place"})
    ).status_code == 200
    await client.post("/api/auth/logout")
    await register_partner(client, "outsider")
    await login_as(client, "outsider")
    refused = await client.patch(
        "/api/users/me", json={"featured_community_slug": "my-own-place"}
    )
    assert refused.status_code == 422
    assert "свои сообщества" in refused.json()["detail"]
    assert (await client.get("/api/communities", params={"mine": "true"})).json() == []
    # The picker never offers someone else's channel, however visible it is in the catalogue.
    everything = {item["slug"] for item in (await client.get("/api/communities")).json()}
    assert "my-own-place" in everything


async def test_a_complaint_about_an_account_is_one_row_per_person(client: AsyncClient) -> None:
    """The same terms as a complaint about a post: stored, replaceable, never about oneself."""
    await register_partner(client, "reporter")
    await login_as(client, "reporter")
    first = await client.post(
        "/api/users/leon/report", json={"reason": "abuse", "comment": "Грубит"}
    )
    assert first.status_code == 201, first.text
    assert first.json()["detail"] == "Жалоба отправлена"
    assert (
        await client.post("/api/users/leon/report", json={"reason": "spam"})
    ).status_code == 201
    mine = await client.post("/api/users/reporter/report", json={"reason": "spam"})
    assert mine.status_code == 400
    ghost = await client.post("/api/users/nobody/report", json={"reason": "spam"})
    assert ghost.status_code == 404


async def test_blocking_unfollows_both_ways_and_closes_the_profile(client: AsyncClient) -> None:
    """A block ends the following in both directions and shuts the content to the blocked side."""
    await register_partner(client, "shunned")
    await login_as(client, "shunned")
    assert (await client.post("/api/users/leon/follow")).status_code == 200
    await client.post("/api/auth/logout")

    await login_demo(client)
    assert (await client.post("/api/users/shunned/follow")).status_code == 200
    before = (await client.get("/api/users/shunned")).json()
    assert before["is_following"] is True
    assert before["blocked_me"] is False
    assert (await client.post("/api/users/shunned/block")).status_code == 200
    after = (await client.get("/api/users/shunned")).json()
    assert after["is_blocked"] is True
    assert after["is_following"] is False

    await client.post("/api/auth/logout")
    await login_as(client, "shunned")
    theirs = (await client.get("/api/users/leon")).json()
    # They are told, they are no longer following, and the tabs are closed to them.
    assert theirs["blocked_me"] is True
    assert theirs["is_following"] is False
    assert theirs["can_view_content"] is False
    posts = await client.get("/api/feed", params={"author": "leon"})
    assert posts.status_code == 403
    assert "заблокировал" in posts.json()["detail"]
    assert (await client.get("/api/users/leon/stories")).status_code == 403
    # Pressing «Читать» again must not walk around it.
    refused = await client.post("/api/users/leon/follow")
    assert refused.status_code == 403
    assert "заблокировал" in refused.json()["detail"]

    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.delete("/api/users/shunned/block")).status_code == 200
    await client.post("/api/auth/logout")
    await login_as(client, "shunned")
    assert (await client.get("/api/users/leon")).json()["can_view_content"] is True
    assert (await client.post("/api/users/leon/follow")).status_code == 200


async def test_a_block_reaches_posts_comments_saves_gifts_and_stars(client: AsyncClient) -> None:
    """A block is not a chat setting: it closes every surface between two accounts."""
    await register_partner(client, "shut_out")
    await login_demo(client)
    post_id = (await client.post("/api/feed", json={"content": "Только для своих"})).json()["id"]
    await client.post("/api/users/shut_out/block")

    await client.post("/api/auth/logout")
    await login_as(client, "shut_out")
    # Their posts leave my lists, in both the mixed feed and the author's page.
    feed = (await client.get("/api/feed")).json()
    assert all(item["author"]["username"] != "leon" for item in feed)
    assert (await client.get("/api/feed", params={"author": "leon"})).status_code == 403
    assert (await client.get(f"/api/feed/{post_id}")).status_code == 403
    # And every action aimed at them is refused rather than quietly dropped.
    for path in (
        f"/api/feed/{post_id}/like",
        f"/api/feed/{post_id}/bookmark",
        f"/api/feed/{post_id}/repost",
        f"/api/feed/{post_id}/view",
    ):
        response = await client.post(path)
        assert response.status_code == 403, f"{path}: {response.status_code}"
    commented = await client.post(f"/api/feed/{post_id}/comments", json={"content": "Привет"})
    assert commented.status_code == 403
    assert (await client.get(f"/api/feed/{post_id}/comments")).status_code == 403
    assert (await client.get("/api/gifts", params={"owner": "leon"})).status_code == 403
    sent = await client.post("/api/stars/send", json={"to_username": "leon", "amount": 5})
    assert sent.status_code == 403

    # Unblocking gives everything back.
    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.delete("/api/users/shut_out/block")).status_code == 200
    await client.post("/api/auth/logout")
    await login_as(client, "shut_out")
    assert (await client.post(f"/api/feed/{post_id}/like")).status_code == 200
    answered = await client.post(f"/api/feed/{post_id}/comments", json={"content": "Привет"})
    assert answered.status_code == 201


async def test_who_can_message_is_enforced_when_a_chat_is_opened(client: AsyncClient) -> None:
    """The switch decides who may start a conversation, and says so when it refuses."""
    await register_partner(client, "stranger_a")
    await login_demo(client)
    assert (await client.get("/api/users/me/settings")).json()["who_can_message"] == "everyone"
    closed = await client.patch("/api/users/me/settings", json={"who_can_message": "nobody"})
    assert closed.json()["who_can_message"] == "nobody"

    await client.post("/api/auth/logout")
    await login_as(client, "stranger_a")
    refused = await client.post("/api/chats/direct/leon")
    assert refused.status_code == 403
    assert "не принимает сообщения" in refused.json()["detail"]
    assert (await client.post("/api/chats/secret/leon")).status_code == 403

    await client.post("/api/auth/logout")
    await login_demo(client)
    await client.patch("/api/users/me/settings", json={"who_can_message": "following"})
    await client.post("/api/auth/logout")
    await login_as(client, "stranger_a")
    only_read = await client.post("/api/chats/direct/leon")
    assert only_read.status_code == 403
    assert "только от тех, кого читает" in only_read.json()["detail"]

    # Once the recipient reads them, the conversation opens.
    await client.post("/api/auth/logout")
    await login_demo(client)
    assert (await client.post("/api/users/stranger_a/follow")).status_code == 200
    await client.post("/api/auth/logout")
    await login_as(client, "stranger_a")
    assert (await client.post("/api/chats/direct/leon")).status_code == 200
    nonsense = await client.patch("/api/users/me/settings", json={"who_can_message": "sometimes"})
    assert nonsense.status_code == 422


async def test_a_refused_follow_request_can_be_asked_again(client: AsyncClient) -> None:
    """Declining is quiet and not permanent; withdrawing is the requester's own business."""
    await register_partner(client, "hopeful")
    await login_demo(client)
    await client.patch("/api/users/me/settings", json={"private_account": True})

    await client.post("/api/auth/logout")
    await login_as(client, "hopeful")
    assert (await client.post("/api/users/leon/follow")).json()["requested"] is True
    # Asking twice does not stack.
    assert (await client.post("/api/users/leon/follow")).json()["requested"] is True

    await client.post("/api/auth/logout")
    await login_demo(client)
    waiting = (await client.get("/api/users/me/follow-requests")).json()
    assert len(waiting) == 1
    declined = await client.delete(f"/api/users/me/follow-requests/{waiting[0]['id']}")
    assert declined.status_code == 200
    assert (await client.get("/api/users/me/follow-requests")).json() == []
    again = await client.delete(f"/api/users/me/follow-requests/{waiting[0]['id']}")
    assert again.status_code == 404

    await client.post("/api/auth/logout")
    await login_as(client, "hopeful")
    assert (await client.get("/api/users/leon")).json()["follow_requested"] is False
    assert (await client.post("/api/users/leon/follow")).json()["requested"] is True
    # Withdrawing an unanswered request is the same gesture as unfollowing.
    assert (await client.delete("/api/users/leon/follow")).status_code == 200
    assert (await client.get("/api/users/leon")).json()["follow_requested"] is False


async def test_the_platform_account_carries_the_admin_badge(client: AsyncClient) -> None:
    """The V badge is granted, not claimed: it travels with the account, nothing sets it."""
    await login_demo(client)
    official = await client.get("/api/users/gram")
    assert official.status_code == 200, official.text
    assert official.json()["is_admin"] is True
    assert (await client.get("/api/users/leon")).json()["is_admin"] is False
    # Nothing in the product may raise it.
    await client.patch("/api/users/me", json={"is_admin": True})
    assert (await client.get("/api/users/leon")).json()["is_admin"] is False


async def test_an_owner_can_refuse_offers_on_a_gift_and_a_handle(client: AsyncClient) -> None:
    """Refusing offers is said once and honoured, and takes a handle off the market with it."""
    await login_demo(client)
    gift = (await client.get("/api/gifts", params={"owner": "leon"})).json()[0]
    closed = await client.patch(f"/api/gifts/{gift['id']}/offers", json={"offers_disabled": True})
    assert closed.status_code == 200, closed.text
    assert closed.json()["offers_disabled"] is True

    handle = next(
        item
        for item in (await client.get("/api/usernames")).json()
        if item.get("is_owned_by_me") and item["username"] != "leon"
    )
    listed = await client.patch(
        f"/api/usernames/{handle['id']}/listing", json={"for_sale": True, "price": 400}
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["status"] == "listed"
    kept = await client.patch(
        f"/api/usernames/{handle['id']}/offers", json={"offers_disabled": True}
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["offers_disabled"] is True
    # "Not for sale" and "listed for sale" cannot both be true.
    assert kept.json()["status"] != "listed"
    assert kept.json()["price"] is None

    await client.post("/api/auth/logout")
    await register_partner(client, "bidder")
    await login_as(client, "bidder")
    refused = await client.post(f"/api/gifts/{gift['id']}/offers", json={"amount_stars": 50})
    assert refused.status_code == 403
    assert "не принимает предложения" in refused.json()["detail"]


async def test_a_closed_account_answers_a_follow_request(client: AsyncClient) -> None:
    """Accepting is what opens the content — the request itself changes nothing."""
    await register_partner(client, "knocker")
    await login_demo(client)
    await client.patch("/api/users/me/settings", json={"private_account": True})
    post_id = (await client.post("/api/feed", json={"content": "За закрытой дверью"})).json()["id"]

    await client.post("/api/auth/logout")
    await login_as(client, "knocker")
    assert (await client.post("/api/users/leon/follow")).json()["requested"] is True
    assert (await client.get("/api/users/leon")).json()["follow_requested"] is True

    await client.post("/api/auth/logout")
    await login_demo(client)
    waiting = await client.get("/api/users/me/follow-requests")
    assert waiting.status_code == 200, waiting.text
    assert [item["user"]["username"] for item in waiting.json()] == ["knocker"]
    assert (await client.get("/api/users/leon")).json()["follow_requests_count"] == 1
    kinds = {item["kind"] for item in (await client.get("/api/notifications")).json()}
    assert "follow_request" in kinds
    accepted = await client.post(f"/api/users/me/follow-requests/{waiting.json()[0]['id']}")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["is_following"] is True
    assert (await client.get("/api/users/me/follow-requests")).json() == []

    await client.post("/api/auth/logout")
    await login_as(client, "knocker")
    assert (await client.get("/api/users/leon")).json()["can_view_content"] is True
    opened = await client.get("/api/feed", params={"author": "leon"})
    assert opened.status_code == 200
    assert any(item["id"] == post_id for item in opened.json())


async def test_premium_unlocks_the_cover_arrangement_and_the_name_marker(
    client: AsyncClient,
) -> None:
    """One gift on the cover is anyone's; the rest, and the one by the name, are Premium."""
    await login_demo(client)
    gifts = (await client.get("/api/gifts", params={"owner": "leon"})).json()
    assert len(gifts) >= 3
    first = await client.put(f"/api/gifts/{gifts[0]['id']}/showcase", json={"slot": "featured"})
    assert first.status_code == 200, first.text
    for slot in ("cover2", "cover3", "cover4", "name"):
        refused = await client.put(f"/api/gifts/{gifts[1]['id']}/showcase", json={"slot": slot})
        assert refused.status_code == 402, f"{slot}: {refused.status_code}"

    await client.post("/api/stars/top-up", json={"amount": 1000})
    assert (await client.post("/api/premium/purchase", json={"plan": "monthly"})).status_code == 200

    for gift, slot in ((gifts[1], "cover2"), (gifts[2], "cover3")):
        filled = await client.put(f"/api/gifts/{gift['id']}/showcase", json={"slot": slot})
        assert filled.status_code == 200, filled.text
    arranged = (await client.get("/api/users/leon")).json()
    assert [item["id"] for item in arranged["cover_gifts"]] == [
        gifts[0]["id"],
        gifts[1]["id"],
        gifts[2]["id"],
    ]

    # One gift cannot be in two places: moving it to the name slot takes it off the cover.
    moved = await client.put(f"/api/gifts/{gifts[0]['id']}/showcase", json={"slot": "name"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["name_gift"]["id"] == gifts[0]["id"]
    assert [item["id"] for item in moved.json()["cover_gifts"]] == [
        gifts[1]["id"],
        gifts[2]["id"],
    ]

    # Emptying a slot is never gated: an account that stops paying must still be able to tidy up.
    cleared = await client.patch("/api/users/me/showcase", json={"name_gift_id": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["name_gift"] is None


async def test_a_complaint_can_be_about_a_chat_a_message_or_a_community(
    client: AsyncClient,
) -> None:
    """Every target is reported on the same terms: one row per person, reason replaceable."""
    await register_partner(client, "noisy")
    await login_demo(client)
    chat = (await client.post("/api/chats/direct/noisy")).json()
    await client.post(f"/api/chats/{chat['id']}/messages", json={"content": "Привет"})
    community = await client.post(
        "/api/communities",
        json={
            "slug": "loud-place",
            "name": "Шумное место",
            "title": "Шумное место",
            "description": "Для проверки жалоб",
        },
    )
    assert community.status_code == 201, community.text
    # One's own community is not a complaint.
    assert (
        await client.post("/api/communities/loud-place/report", json={"reason": "spam"})
    ).status_code == 400

    await client.post("/api/auth/logout")
    await login_as(client, "noisy")
    theirs = (await client.get(f"/api/chats/{chat['id']}/messages")).json()[-1]
    filed = await client.post(
        f"/api/chats/{chat['id']}/report", json={"reason": "abuse", "comment": "Грубит"}
    )
    assert filed.status_code == 201, filed.text
    assert filed.json()["detail"] == "Жалоба отправлена"
    # Complaining twice replaces the reason instead of stacking.
    assert (
        await client.post(f"/api/chats/{chat['id']}/report", json={"reason": "spam"})
    ).status_code == 201
    message_report = await client.post(
        f"/api/chats/{chat['id']}/messages/{theirs['id']}/report", json={"reason": "abuse"}
    )
    assert message_report.status_code == 201, message_report.text
    assert (
        await client.post("/api/communities/loud-place/report", json={"reason": "fraud"})
    ).status_code == 201

    # One's own words are not a complaint, and a reason has to be one of the six.
    mine = (
        await client.post(f"/api/chats/{chat['id']}/messages", json={"content": "Ответ"})
    ).json()
    assert (
        await client.post(
            f"/api/chats/{chat['id']}/messages/{mine['id']}/report", json={"reason": "abuse"}
        )
    ).status_code == 400
    assert (
        await client.post(f"/api/chats/{chat['id']}/report", json={"reason": "не нравится"})
    ).status_code == 422

    # A chat this account is not in cannot be reported at all.
    await register_partner(client, "outsider")
    await login_as(client, "outsider")
    assert (
        await client.post(f"/api/chats/{chat['id']}/report", json={"reason": "spam"})
    ).status_code == 403


async def test_a_channel_post_is_a_post_in_every_way(client: AsyncClient) -> None:
    """Likes, comments, views, pinning and editing — the same contract as a personal post."""
    await register_partner(client, "reader_c")
    await login_demo(client)
    created = await client.post(
        "/api/communities",
        json={"slug": "field-notes", "title": "Field Notes", "description": "Наблюдения"},
    )
    assert created.status_code == 201, created.text

    published = await client.post(
        "/api/communities/field-notes/posts",
        json={
            "content": "Первая запись канала",
            "image_urls": ["https://example.com/a.jpg"],
            "link_url": "https://example.com/notes",
            "link_title": "Заметки",
        },
    )
    assert published.status_code == 201, published.text
    post = published.json()
    assert post["community_slug"] == "field-notes"
    assert post["community_title"] == "Field Notes"
    assert post["image_urls"] == ["https://example.com/a.jpg"]
    assert post["link_url"] == "https://example.com/notes"
    assert post["likes_count"] == 0
    assert post["can_edit"] is True

    # A channel is its own surface: its posts do not turn up in a personal feed or on the
    # owner's profile, where they would read as something the person wrote themselves.
    assert all(item["id"] != post["id"] for item in (await client.get("/api/feed")).json())
    own_page = await client.get("/api/feed", params={"author": "leon"})
    assert all(item["id"] != post["id"] for item in own_page.json())

    second = await client.post(
        "/api/communities/field-notes/posts", json={"content": "Вторая запись"}
    )
    assert second.status_code == 201
    pinned = await client.post(f"/api/feed/{post['id']}/pin")
    assert pinned.status_code == 200, pinned.text
    listed = (await client.get("/api/communities/field-notes/posts")).json()
    assert [item["id"] for item in listed] == [post["id"], second.json()["id"]]
    assert listed[0]["is_pinned"] is True

    edited = await client.patch(
        f"/api/feed/{post['id']}", json={"content": "Первая запись канала, дополнено"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["edited_at"] is not None

    # A member reads, answers and counts — but does not publish.
    await client.post("/api/auth/logout")
    await login_as(client, "reader_c")
    assert (await client.post("/api/communities/field-notes/join")).status_code in {200, 201}
    refused = await client.post(
        "/api/communities/field-notes/posts", json={"content": "А можно мне?"}
    )
    assert refused.status_code == 403
    assert (await client.post(f"/api/feed/{post['id']}/like")).status_code == 200
    commented = await client.post(
        f"/api/feed/{post['id']}/comments", json={"content": "Отличная идея"}
    )
    assert commented.status_code == 201, commented.text
    assert (await client.post(f"/api/feed/{post['id']}/view")).json()["recorded"] is True

    answered = next(
        item
        for item in (await client.get("/api/communities/field-notes/posts")).json()
        if item["id"] == post["id"]
    )
    assert answered["likes_count"] == 1
    assert answered["comments_count"] == 1
    assert answered["views_count"] >= 1
    assert answered["can_edit"] is False
    thread = await client.get(f"/api/feed/{post['id']}/comments")
    assert [item["content"] for item in thread.json()] == ["Отличная идея"]


async def test_only_staff_grant_a_channel_its_tick(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An owner who could tick their own channel would be ticking nothing."""
    await login_demo(client)
    created = await client.post(
        "/api/communities",
        json={"slug": "tick-test", "title": "Tick", "description": "Проверка"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["is_verified"] is False
    refused = await client.patch(
        "/api/communities/tick-test/verification", json={"verified": True}
    )
    assert refused.status_code == 403
    assert "команда GRAM" in refused.json()["detail"]

    # Staff can, and the grant reaches every surface that draws the channel. The flag is set
    # the only way it ever is: in the database, by the platform — never through the product.
    await db_session.execute(update(User).where(User.username == "leon").values(is_admin=True))
    await db_session.commit()
    granted = await client.patch(
        "/api/communities/tick-test/verification", json={"verified": True}
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["is_verified"] is True
    assert (await client.get("/api/communities/tick-test")).json()["is_verified"] is True
    published = await client.post(
        "/api/communities/tick-test/posts", json={"content": "С галочкой"}
    )
    assert published.status_code == 201, published.text
    assert published.json()["community_verified"] is True


def _tiny_mp4() -> bytes:
    """The smallest thing a container check accepts: an `ftyp` box at offset 4."""
    return b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64


async def test_a_post_carries_one_clip_and_refuses_anything_else(client: AsyncClient) -> None:
    """The container is read from the bytes, so a renamed file is not a video."""
    await login_demo(client)
    uploaded = await client.post(
        "/api/feed/video",
        files={"file": ("clip.mp4", _tiny_mp4(), "video/mp4")},
    )
    assert uploaded.status_code == 201, uploaded.text
    url = uploaded.json()["url"]
    assert url.startswith("/media/posts/")
    assert url.endswith(".mp4")

    published = await client.post("/api/feed", json={"content": "С видео", "video_url": url})
    assert published.status_code == 201, published.text
    assert published.json()["video_url"] == url
    assert (await client.get(f"/api/feed/{published.json()['id']}")).json()["video_url"] == url

    # A picture, an archive or a script renamed to .mp4 is refused on its content.
    for payload in (b"GIF89a" + b"\x00" * 32, b"PK\x03\x04" + b"\x00" * 32, b"#!/bin/sh\n"):
        refused = await client.post(
            "/api/feed/video", files={"file": ("clip.mp4", payload, "video/mp4")}
        )
        assert refused.status_code == 415, refused.status_code

    # And the ceiling is the ceiling.
    too_big = b"\x00\x00\x00\x18ftypisom" + b"\x00" * (64 * 1024 * 1024)
    assert (
        await client.post("/api/feed/video", files={"file": ("big.mp4", too_big, "video/mp4")})
    ).status_code == 413


async def test_a_post_can_ask_a_question_and_be_answered_once(client: AsyncClient) -> None:
    """Counts come from rows, a vote is final, and a poll of one answer is not a poll."""
    await register_partner(client, "voter_one")
    await register_partner(client, "voter_two")
    await login_demo(client)
    asked = await client.post(
        "/api/feed",
        json={"content": "Ночь или утро?", "poll_options": ["Ночь", "Утро", "  "]},
    )
    assert asked.status_code == 201, asked.text
    poll = asked.json()["poll"]
    assert [option["text"] for option in poll["options"]] == ["Ночь", "Утро"]
    assert poll["total_votes"] == 0
    assert poll["my_choice"] is None
    post_id = asked.json()["id"]

    # Two answers that are the same answer, and a poll with one option, are both refused.
    assert (
        await client.post(
            "/api/feed", json={"content": "Опрос", "poll_options": ["Да", "да"]}
        )
    ).status_code == 422
    assert (
        await client.post("/api/feed", json={"content": "Опрос", "poll_options": ["Да"]})
    ).status_code == 422

    voted = await client.post(f"/api/feed/{post_id}/poll/0")
    assert voted.status_code == 200, voted.text
    assert voted.json()["poll"]["my_choice"] == 0
    assert voted.json()["poll"]["total_votes"] == 1
    # A vote is final: the reference's poll is a snapshot, not a survey.
    again = await client.post(f"/api/feed/{post_id}/poll/1")
    assert again.status_code == 409
    assert "уже ответили" in again.json()["detail"]
    assert (await client.post(f"/api/feed/{post_id}/poll/7")).status_code == 404

    for username, choice in (("voter_one", 1), ("voter_two", 1)):
        await client.post("/api/auth/logout")
        await login_as(client, username)
        assert (await client.post(f"/api/feed/{post_id}/poll/{choice}")).status_code == 200

    await client.post("/api/auth/logout")
    await login_demo(client)
    counted = (await client.get(f"/api/feed/{post_id}")).json()["poll"]
    assert [option["votes"] for option in counted["options"]] == [1, 2]
    assert counted["total_votes"] == 3
    assert counted["my_choice"] == 0

    # A post without a poll has nothing to answer.
    plain = (await client.post("/api/feed", json={"content": "Без опроса"})).json()
    assert plain["poll"] is None
    assert (await client.post(f"/api/feed/{plain['id']}/poll/0")).status_code == 400


async def test_an_author_marks_their_own_attachments_as_sensitive(client: AsyncClient) -> None:
    """The mark is the author's, it travels with the post, and an edit can lift it."""
    await login_demo(client)
    plain = await client.post("/api/feed", json={"content": "Обычная запись"})
    assert plain.status_code == 201, plain.text
    assert plain.json()["sensitive"] is False

    marked = await client.post(
        "/api/feed",
        json={
            "content": "Не для всех",
            "image_urls": ["https://example.com/a.jpg"],
            "sensitive": True,
        },
    )
    assert marked.status_code == 201, marked.text
    assert marked.json()["sensitive"] is True
    post_id = marked.json()["id"]
    # It travels: a reader gets the mark, not a guess about the pictures.
    await register_partner(client, "looker")
    await client.post("/api/auth/logout")
    await login_as(client, "looker")
    seen = next(
        item for item in (await client.get("/api/feed")).json() if item["id"] == post_id
    )
    assert seen["sensitive"] is True
    assert seen["image_urls"] == ["https://example.com/a.jpg"]

    await client.post("/api/auth/logout")
    await login_demo(client)
    lifted = await client.patch(
        f"/api/feed/{post_id}", json={"content": "Не для всех", "sensitive": False}
    )
    assert lifted.status_code == 200, lifted.text
    assert lifted.json()["sensitive"] is False
    # An edit that says nothing about the mark leaves it alone.
    again = await client.patch(f"/api/feed/{post_id}", json={"content": "Совсем другое"})
    assert again.json()["sensitive"] is False
