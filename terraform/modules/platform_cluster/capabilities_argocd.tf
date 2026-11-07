# Managed Argo CD bills per capability-hour plus per Application-hour, so it
# is off until there is something for it to deploy (var.enable_argocd).
resource "aws_eks_capability" "argocd" {
  count = var.enable_argocd ? 1 : 0

  cluster_name              = module.eks.cluster_name
  capability_name           = "${local.cluster_name}-argocd"
  type                      = "ARGOCD"
  role_arn                  = aws_iam_role.argocd_capability[0].arn
  delete_propagation_policy = "RETAIN"

  configuration {
    argo_cd {
      aws_idc {
        idc_instance_arn = var.identity_center_instance_arn
        idc_region       = var.aws_region
      }

      rbac_role_mapping {
        role = "ADMIN"

        identity {
          id   = var.argocd_admin_group_id
          type = "SSO_GROUP"
        }
      }
    }
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy.argocd_codeconnections]
}

resource "aws_eks_access_policy_association" "argocd_cluster_admin" {
  count = var.enable_argocd ? 1 : 0

  cluster_name  = module.eks.cluster_name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = aws_iam_role.argocd_capability[0].arn

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_capability.argocd]
}
