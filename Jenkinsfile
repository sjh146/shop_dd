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

        // P2+: contracts (hardhat), server (go test golang:1.25), web (vite build) 스테이지 추가
        // stage('contracts_test') { sh 'docker compose run --rm --build test-contracts' }
        // stage('backend_test')  { sh 'docker compose run --rm --build test-go' }
        // stage('frontend_ci')   { sh 'docker compose run --rm --build test-front' }
        // stage('compose_smoke') { sh 'docker compose config -q' }
    }

    post {
        always {
            sh 'docker compose down --remove-orphans || true'
            deleteDir()
        }
    }
}
