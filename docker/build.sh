#!/bin/bash
set -euo pipefail

IMAGE="${IMAGE:-ortegarodrigo/nemoflix-flux2}"
TAG="${TAG:-latest}"

echo "Building ${IMAGE}:${TAG} ..."
docker build -t "${IMAGE}:${TAG}" .

echo "Pushing ${IMAGE}:${TAG} ..."
docker push "${IMAGE}:${TAG}"

echo "Done. Image: ${IMAGE}:${TAG}"
