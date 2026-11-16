// Módulos nativos (sharp, argon2) e o SDK do S3 não existem no Cloudflare Workers; o código trata a ausência.
throw new Error('Módulo indisponível no Cloudflare Workers');
