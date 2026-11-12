# AWS access for the development environment

Two policies give the identity that builds the development environment what it needs and no more. They assume the region `us-east-1`, the IAM user `service-commandline-user`, and that every resource the project creates has a name starting with `ucp-dev`.

| File | What it is | Where it goes |
|---|---|---|
| `ucp-dev-boundary-policy.json` | The ceiling for any role the project creates | A customer managed policy named exactly `ucp-dev-boundary`. It is attached to nothing. |
| `ucp-dev-deployer-policy.json` | What the deploying identity may do | A customer managed policy named `ucp-dev-deployer`, attached to `service-commandline-user`. |

## Steps for an AWS administrator

In the IAM console:

1. Policies, Create policy, JSON tab. Paste `ucp-dev-boundary-policy.json`. Name it `ucp-dev-boundary`. The name matters, because the deployer policy refers to it.
2. Policies, Create policy, JSON tab. Paste `ucp-dev-deployer-policy.json`. Name it `ucp-dev-deployer`.
3. Users, `service-commandline-user`, Add permissions, Attach policies directly, choose `ucp-dev-deployer`.

Or from a command line with administrator rights, run from this folder:

```
aws iam create-policy --policy-name ucp-dev-boundary --policy-document file://ucp-dev-boundary-policy.json
aws iam create-policy --policy-name ucp-dev-deployer --policy-document file://ucp-dev-deployer-policy.json
aws iam attach-user-policy --user-name service-commandline-user --policy-arn arn:aws:iam::<account-id>:policy/ucp-dev-deployer
```

Then, as `service-commandline-user`, run `bash verify-access.sh`. It creates nothing. It asks IAM to evaluate thirteen actions that must be allowed and eight that must be refused.

## What the deployer policy allows

| Statement | In plain words |
|---|---|
| `ReadForPlanning` | Read-only listing and describing, so the infrastructure tool can compare what exists with what is wanted. |
| `TaskDefinitions` | Register and retire container task definitions in `us-east-1`. |
| `NetworkInUsEast1` | Create and change a network in `us-east-1`: the VPC, subnets, routes, gateways and security groups. |
| `ProjectNamedResources` | Full control of containers, the image registry, the load balancer, the database, logs, secrets, storage buckets, alarms and dashboards, but only those whose names start with `ucp-dev`. |
| `ContentDelivery` | CloudFront, which serves the loader and the chat over HTTPS. |
| `ProjectRolesReadAndTidy` | Read, tag and delete roles whose names start with `ucp-dev-`. |
| `ProjectRolesMustCarryBoundary` | Create such roles and set their permissions, but only if the role carries the `ucp-dev-boundary` ceiling. |
| `PassProjectRolesToEcsTasks` | Hand those roles to the container service and to nothing else. |
| `ServiceLinkedRoles` | Let AWS create its own standard roles for the container service, the load balancer and the database. |
| `GitHubSignIn` | Register GitHub as a sign-in source, so the build pipeline can deploy without stored access keys. |
| `InspectOwnAccess` | Let this user read its own permissions and run the verification script. |
| `ReadProjectPolicies` | Read these two policies. |

## What it does not allow

- IAM users, groups, access keys or managed policies.
- Any role without the boundary, or any role not named `ucp-dev-*`. This closes the usual route to wider access: a role the project creates can never do more than the boundary allows, and the boundary contains no permission to change IAM.
- Other teams' buckets, secrets, databases, clusters, load balancers or log groups. The policy matches by name.
- Regional services outside `us-east-1`.
- A web application firewall, certificates for our own web addresses, DNS, and scheduled jobs. These are not needed for the base version and will come as a small addition.

## Limits to know

- Networking and CloudFront cannot be limited by name. In `us-east-1` this identity could change other VPCs, security groups and CloudFront distributions in the same account. If the account hosts other systems, a separate account for this project is the cleaner answer.
- The policies could not be run through AWS's own policy checker from the build machine, because its current identity may not call it. The IAM console checks the JSON when it is pasted.
- Production in London needs its own copy with the region and the name prefix changed.
