curl -s -o /dev/null -w "%{http_code}" "/api/job-ceo/dispatch" || echo " CURL FAILED"
