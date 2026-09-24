from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

# 1. Launch Chrome browser
driver = webdriver.Chrome()
driver.maximize_window()

# Set up our smart wait tool (maximum wait time of 15 seconds)
wait = WebDriverWait(driver, 15)

# 2. Open the login page and authenticate as HR
driver.get("https://hiretrack1-xi.vercel.app/signin")
time.sleep(2)

driver.find_element(By.CSS_SELECTOR, "input[type='email']").send_keys("kevin@hiretrack.lk")
driver.find_element(By.CSS_SELECTOR, "input[type='password']").send_keys("kevin12345")
driver.find_element(By.XPATH, "//button[contains(text(), 'Sign in')]").click()

# Wait specifically for the dashboard to load before jumping to the new vacancy page
wait.until(EC.url_contains("/dashboard"))
driver.get("https://hiretrack1-xi.vercel.app/vacancies/new")
time.sleep(2)

# 3. Generate a unique job title
unique_job_title = f"Software Engineer Automated {int(time.time())}"

# 4. Find all form fields
title_box = driver.find_element(By.XPATH, "//label[contains(text(), 'Job title')]/..//input")
dept_box = driver.find_element(By.XPATH, "//label[contains(text(), 'Department')]/..//input")
location_box = driver.find_element(By.XPATH, "//label[contains(text(), 'Location')]/..//input")
closing_date_box = driver.find_element(By.XPATH, "//label[contains(text(), 'Closing date')]/..//input | //input[@type='date']")
desc_box = driver.find_element(By.XPATH, "//label[contains(text(), 'Description')]/..//textarea")

# 5. Fill out the fields
title_box.send_keys(unique_job_title)
dept_box.send_keys("IT")
location_box.send_keys("Colombo")
closing_date_box.send_keys("12312026") 
desc_box.send_keys("Automated test description for this role.")

# 6. Scroll down and click the yellow "Create vacancy" button
create_button = driver.find_element(By.XPATH, "//button[contains(text(), 'Create vacancy')]")
driver.execute_script("arguments[0].scrollIntoView(true);", create_button)
time.sleep(1) 
driver.execute_script("arguments[0].click();", create_button)

# 7. SMART WAIT: Wait up to 15 seconds for the browser to leave the "new vacancy" page
print("Saving... waiting for database confirmation.")
wait.until_not(EC.url_contains("/vacancies/new"))

# Pause for 2 seconds to let the vacancies table fully render the new data
time.sleep(2)

# 8. Verify the job was created successfully by checking the page text
if unique_job_title in driver.page_source:
    print(f"✅ Test Passed: Job '{unique_job_title}' created successfully.")
else:
    print("❌ Test Failed: Could not verify job creation.")

# 9. Close browser
driver.quit()