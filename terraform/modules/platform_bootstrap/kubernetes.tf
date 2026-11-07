resource "kubernetes_secret_v1" "platform_cluster" {
  metadata {
    name      = "platform-cluster"
    namespace = "argocd"
    labels = {
      "argocd.argoproj.io/secret-type" = "cluster"
      platform_cluster                 = "true"
      workload_cluster                 = "true"
      cluster_name                     = var.cluster_name
      environment                      = var.environment
    }
    annotations = {
      gitops_repo_url                       = var.gitops_repo_url
      gitops_platform_path                  = var.gitops_platform_path
      gitops_revision                       = var.gitops_revision
      vpc_id                                = var.vpc_id
      aws_region                            = var.aws_region
      aws_load_balancer_controller_role_arn = var.aws_load_balancer_controller_role_arn
      grafana_cloud_parameter_path          = var.grafana_cloud_parameter_path
    }
  }

  data = {
    name    = var.cluster_name
    server  = var.cluster_arn
    project = "default"
  }

  type = "Opaque"
}

resource "kubernetes_manifest" "bootstrap" {
  manifest = {
    apiVersion = "argoproj.io/v1alpha1"
    kind       = "ApplicationSet"
    metadata = {
      name      = "platform-bootstrap"
      namespace = "argocd"
    }
    spec = {
      // Required: the template below uses Go-template syntax ({{ .name }},
      // {{ .metadata.annotations.* }}). Without this, Argo CD falls back to
      // legacy fasttemplate, which only understands {{name}}/{{server}} and
      // cannot traverse annotations - every Application fails validation.
      goTemplate        = true
      goTemplateOptions = ["missingkey=error"]

      generators = [
        {
          clusters = {
            selector = {
              matchLabels = {
                platform_cluster = "true"
              }
            }
          }
        },
      ]
      template = {
        metadata = {
          name = "{{ .name }}-platform-bootstrap"
        }
        spec = {
          project = "default"
          source = {
            repoURL        = "{{ .metadata.annotations.gitops_repo_url }}"
            targetRevision = "{{ .metadata.annotations.gitops_revision }}"
            path           = "{{ .metadata.annotations.gitops_platform_path }}bootstrap"
            directory = {
              recurse = true
            }
          }
          destination = {
            server    = "{{ .server }}"
            namespace = "argocd"
          }
          syncPolicy = {
            automated = {
              prune      = true
              allowEmpty = true
            }
            syncOptions = ["ServerSideApply=true"]
          }
        }
      }
    }
  }

  depends_on = [kubernetes_secret_v1.platform_cluster]
}
