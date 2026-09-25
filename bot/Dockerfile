FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# The bot's whole dependency list. It talks to two HTTP APIs and nothing else, so it does not
# borrow the backend's image: that one installs no `httpx` outside its dev group, and adding a
# client library to the API only to run a different process would be the wrong place for it.
RUN pip install --no-cache-dir "httpx>=0.28.1,<1"

COPY gram_stars_bot.py ./

CMD ["python", "gram_stars_bot.py"]
