#!/usr/bin/env bash
# Checks that the deploying identity has the access in ucp-dev-deployer-policy.json and nothing wider.
# Creates nothing: it asks IAM to evaluate each action. Run it after the policies are attached.
set -uo pipefail

account="$(aws sts get-caller-identity --query Account --output text)"
me="$(aws sts get-caller-identity --query Arn --output text)"
failures=0

# Without this, every "denied" check below would pass for the wrong reason.
if ! aws iam simulate-principal-policy --policy-source-arn "$me" --action-names sts:GetCallerIdentity > /dev/null 2>&1; then
  echo "This identity may not evaluate its own access yet, so the deployer policy is not attached."
  exit 2
fi

# check <allowed|denied> <action> <resource> [context entries...]
check() {
  local want="$1" action="$2" resource="$3"; shift 3
  local decision
  decision="$(aws iam simulate-principal-policy --policy-source-arn "$me" --action-names "$action" \
    --resource-arns "$resource" ${1:+--context-entries "$@"} \
    --query 'EvaluationResults[0].EvalDecision' --output text 2>&1 | tail -1)"
  local got="denied"; [ "$decision" = "allowed" ] && got="allowed"
  if [ "$got" = "$want" ]; then echo "ok    $want  $action"; else echo "WRONG wanted $want, got $decision  $action on $resource"; failures=$((failures + 1)); fi
}

region="ContextKeyName=aws:RequestedRegion,ContextKeyValues=us-east-1,ContextKeyType=string"
boundary="ContextKeyName=iam:PermissionsBoundary,ContextKeyValues=arn:aws:iam::$account:policy/ucp-dev-boundary,ContextKeyType=string"
to_ecs="ContextKeyName=iam:PassedToService,ContextKeyValues=ecs-tasks.amazonaws.com,ContextKeyType=string"

echo "== needed for the development environment"
check allowed ecs:CreateCluster "arn:aws:ecs:us-east-1:$account:cluster/ucp-dev-main"
check allowed ecs:CreateService "arn:aws:ecs:us-east-1:$account:service/ucp-dev-main/ucp-dev-gateway"
check allowed ecr:CreateRepository "arn:aws:ecr:us-east-1:$account:repository/ucp-dev-gateway"
check allowed elasticloadbalancing:CreateLoadBalancer "arn:aws:elasticloadbalancing:us-east-1:$account:loadbalancer/app/ucp-dev-gateway/0"
check allowed ec2:GetSecurityGroupsForVpc "arn:aws:ec2:us-east-1:$account:vpc/vpc-0"  # checked when a load balancer is created
check allowed rds:CreateDBInstance "arn:aws:rds:us-east-1:$account:db:ucp-dev-main"
check allowed secretsmanager:CreateSecret "arn:aws:secretsmanager:us-east-1:$account:secret:ucp-dev/pf-AbCdEf"
check allowed s3:CreateBucket "arn:aws:s3:::ucp-dev-assets-$account"
check allowed logs:CreateLogGroup "arn:aws:logs:us-east-1:$account:log-group:/ucp-dev/gateway"
check allowed ec2:CreateVpc "*" "$region"
check allowed ec2:CreateSecurityGroup "*" "$region"
check allowed cloudfront:CreateDistribution "*"
check allowed iam:CreateRole "arn:aws:iam::$account:role/ucp-dev-task" "$boundary"
check allowed iam:PassRole "arn:aws:iam::$account:role/ucp-dev-task" "$to_ecs"

echo "== must stay out of reach"
check denied iam:CreateRole "arn:aws:iam::$account:role/ucp-dev-task"
check denied iam:CreateRole "arn:aws:iam::$account:role/something-else" "$boundary"
check denied iam:CreateUser "arn:aws:iam::$account:user/anyone"
check denied iam:AttachUserPolicy "$me"
check denied s3:DeleteBucket "arn:aws:s3:::another-teams-bucket"
check denied secretsmanager:GetSecretValue "arn:aws:secretsmanager:us-east-1:$account:secret:another-teams-secret-AbCdEf"
check denied rds:DeleteDBInstance "arn:aws:rds:us-east-1:$account:db:another-teams-database"
check denied ecs:DeleteCluster "arn:aws:ecs:us-east-1:$account:cluster/another-teams-cluster"

echo
[ "$failures" = 0 ] && echo "All checks passed." || { echo "$failures check(s) did not match."; exit 1; }
