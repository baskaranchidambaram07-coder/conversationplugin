# AWS access for the development environment

Two policies give the identity that builds the development environment what it needs and no more. They assume the region `us-east-1`, the IAM user `service-commandline-user`, and that every resource the project creates has a name starting with `ucp-dev`.

| File | Policy name | What it is | Attached to |
|---|---|---|---|
| `ucp-dev-boundary.json` | `ucp-dev-boundary` | The ceiling for any role the project creates | Nothing |
| `ucp-dev-deployer.json` | `ucp-dev-deployer` | What the deploying identity may do | The user `service-commandline-user` |

Each policy is named after its file, without `.json`. The deployer policy refers to the boundary by that exact name.

## Both must be managed policies, not inline policies

An inline policy is one typed directly onto a user. It cannot be used here, for two reasons:

- All inline policies on one user share a limit of 2,048 characters. The deployer policy is 4,688. A managed policy may be up to 6,144.
- AWS accepts only a managed policy as a permissions boundary.

If the boundary document was added to the user as an inline policy, remove it from the user. It does no harm there, but it is not acting as a boundary, and it gives the user permissions that were meant only as a ceiling for other roles.

## Steps for an AWS administrator

In the IAM console:

1. In the left menu choose **Policies** (not Users). Choose **Create policy**, then the **JSON** tab. Paste the contents of `ucp-dev-boundary.json`. Choose Next, enter the name `ucp-dev-boundary`, and create it. Attach it to nothing.
2. Again under **Policies**, **Create policy**, **JSON**. Paste `ucp-dev-deployer.json`. Name it `ucp-dev-deployer` and create it.
3. Now go to **Users**, open `service-commandline-user`, choose **Add permissions**, then **Attach policies directly**. Search for `ucp-dev-deployer`, tick it, and add it.

Or from a command line with administrator rights, run from this folder:

```
aws iam create-policy --policy-name ucp-dev-boundary --policy-document file://ucp-dev-boundary.json
aws iam create-policy --policy-name ucp-dev-deployer --policy-document file://ucp-dev-deployer.json
aws iam attach-user-policy --user-name service-commandline-user --policy-arn arn:aws:iam::<account-id>:policy/ucp-dev-deployer
```

Then, as `service-commandline-user`, run `bash verify-access.sh`. It creates nothing. It asks IAM to evaluate fourteen actions that must be allowed and eight that must be refused.

## Updating a policy after a change to its file

The deploying user cannot change its own policy, by design. An administrator publishes the file as the policy's new default version.

In the IAM console: **Policies**, open `ucp-dev-deployer`, choose **Edit**, then the **JSON** tab, paste the whole file, choose **Next**, then **Save changes**.

Or, with administrator rights, from this folder:

```
aws iam create-policy-version --policy-arn arn:aws:iam::<account-id>:policy/ucp-dev-deployer --policy-document file://ucp-dev-deployer.json --set-as-default
```

A policy keeps at most five versions. If AWS refuses because five exist, first delete the oldest version that is not the default:

```
aws iam list-policy-versions --policy-arn arn:aws:iam::<account-id>:policy/ucp-dev-deployer
aws iam delete-policy-version --policy-arn arn:aws:iam::<account-id>:policy/ucp-dev-deployer --version-id v1
```

Then, as `service-commandline-user`, run `bash verify-access.sh` again.

## What the deployer policy allows

| Statement | In plain words |
|---|---|
| `ReadForPlanning` | Read-only listing and describing, so the infrastructure tool can compare what exists with what is wanted. |
| `TaskDefinitions` | Register and retire container task definitions in `us-east-1`. |
| `NetworkInUsEast1` | Create and change a network in `us-east-1`: the VPC, subnets, routes, gateways and security groups, and read a network's security groups, which AWS checks on the caller's behalf when a load balancer is created (added on 13 November 2026, version 2 of the policy). |
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
