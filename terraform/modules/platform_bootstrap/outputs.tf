output "cluster_secret_name" {
  description = "Name of the Argo CD cluster registration Secret."
  value       = kubernetes_secret_v1.platform_cluster.metadata[0].name
}

output "bootstrap_applicationset_name" {
  description = "Name of the root ApplicationSet that discovers platform bootstrap configuration."
  value       = kubernetes_manifest.bootstrap.manifest.metadata.name
}
