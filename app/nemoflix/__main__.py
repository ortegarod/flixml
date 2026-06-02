import uvicorn

uvicorn.run("nemoflix.api:app", host="0.0.0.0", port=8191, reload=False)
