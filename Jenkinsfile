// shop_dd — Jenkins 파이프라인 (P1 placeholder → 단계별 확장)
// GitHub push 웹훅 + SCM 폴링 트리거. 각 단계는 docker로 격리 실행.
pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout()
    }

    environment {
        COMPOSE_PROJECT_NAME = 'shop_dd_ci'
    }

    stages {
        stage('checkout') {
            steps {
                checkout scm
            }
        }

        stage('smoke') {
            steps {
                sh 'echo "shop_dd CI OK - $(git rev-parse --short HEAD) - $(date -u +%FT%TZ)"'
                sh 'docker version --format "docker {{.Server.Version}}"'
                sh 'test -f PLAN.md && test -f P0_ANALYSIS.md && echo "plan artifacts present"'
            }
        }

        // P4: backend_test — Go build/vet/test in golang:1.25 (Dockerfile.ci)
        stage('backend_test') {
            steps {
                sh 'docker build -f server/Dockerfile.ci -t shop-server-ci . && docker run --rm shop-server-ci'
            }
        }

        // P4: frontend_ci — web (vite build) in node:22-alpine (Dockerfile.ci)
        stage('frontend_ci') {
            steps {
                sh 'docker build -f web/Dockerfile.ci -t shop-web-ci . && docker run --rm shop-web-ci'
            }
        }

        // P2+: contracts (hardhat), compose_smoke 스테이지 추가
        // stage('contracts_test') { sh 'docker compose run --rm --build test-contracts' }
        // stage('compose_smoke') { sh 'docker compose config -q' }
    }

    post {
        always {
            sh 'docker compose down --remove-orphans || true'
            deleteDir()
        }
    }
}
