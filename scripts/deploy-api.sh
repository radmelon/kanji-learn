#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-api.sh — Build, push to ECR, and redeploy on AWS App Runner
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - Docker installed and running
#   - First run: set APPRUNNER_SERVICE_ARN below after creating the service
#
# Usage:
#   ./scripts/deploy-api.sh                 # deploys to production
#   AWS_PROFILE=staging ./scripts/deploy-api.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config — edit these once ──────────────────────────────────────────────────

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="kanji-learn-api"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Paste the App Runner service ARN here after first deploy:
# e.g. arn:aws:apprunner:us-east-1:123456789012:service/kanji-learn-api/abc123
APPRUNNER_SERVICE_ARN="${APPRUNNER_SERVICE_ARN:-}"

# ── Derived values ────────────────────────────────────────────────────────────

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
FULL_IMAGE="${ECR_URI}/${ECR_REPO}:${IMAGE_TAG}"
DOCKERFILE="apps/api/Dockerfile"
CONTEXT="."   # build context is monorepo root (Dockerfile COPYs from here)

# ── Step 1: Authenticate Docker with ECR ─────────────────────────────────────

echo "🔑 Logging in to ECR…"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_URI"

# ── Step 2: Create ECR repo if it doesn't exist ───────────────────────────────

echo "📦 Ensuring ECR repository exists…"
aws ecr describe-repositories \
  --repository-names "$ECR_REPO" \
  --region "$AWS_REGION" > /dev/null 2>&1 \
  || aws ecr create-repository \
       --repository-name "$ECR_REPO" \
       --region "$AWS_REGION" \
       --image-scanning-configuration scanOnPush=true \
       --query 'repository.repositoryUri' \
       --output text

# ── Step 3: Build image ───────────────────────────────────────────────────────

echo "🐳 Building Docker image…"
docker build \
  --platform linux/amd64 \
  -f "$DOCKERFILE" \
  -t "$FULL_IMAGE" \
  "$CONTEXT"

# ── Step 4: Push to ECR ───────────────────────────────────────────────────────

echo "⬆️  Pushing to ECR…"
docker push "$FULL_IMAGE"

echo "✅ Image pushed: $FULL_IMAGE"

# ── Step 5: Trigger App Runner redeployment ───────────────────────────────────

if [ -z "$APPRUNNER_SERVICE_ARN" ]; then
  echo ""
  echo "⚠️  APPRUNNER_SERVICE_ARN not set — skipping redeployment trigger."
  echo "   Set it in this script or via environment variable after creating"
  echo "   the App Runner service (see README for first-time setup steps)."
else
  echo "🚀 Triggering App Runner deployment…"
  aws apprunner start-deployment \
    --service-arn "$APPRUNNER_SERVICE_ARN" \
    --region "$AWS_REGION" \
    --query 'OperationId' \
    --output text
  echo "✅ Deployment triggered. Monitor at:"
  echo "   https://${AWS_REGION}.console.aws.amazon.com/apprunner/home?region=${AWS_REGION}"
fi

echo ""
echo "🎉 Done!"
