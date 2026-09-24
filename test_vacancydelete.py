from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

# 1. Launch Chrome and set up the smart wait
driver = webdriver.Chrome()
driver.maximize_window()
wait = WebDriverWait(driver, 15)

try:
    # 2. Login
    driver.get("https://hiretrack1-xi.vercel.app/signin")
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='email']")))
    driver.find_element(By.CSS_SELECTOR, "input[type='email']").send_keys("kevin@hiretrack.lk")
    driver.find_element(By.CSS_SELECTOR, "input[type='password']").send_keys("kevin12345")
    driver.find_element(By.XPATH, "//button[contains(text(), 'Sign in')]").click()

    wait.until(EC.url_contains("/dashboard"))

    # 3. Navigate to Vacancies
    driver.get("https://hiretrack1-xi.vercel.app/vacancies")

    # Wait for the automated test jobs to load in the list
    wait.until(EC.presence_of_element_located((By.XPATH, "//a[contains(text(), 'Software Engineer Automated')]")))

    # 4. Find the first automated job and click it using JavaScript (bypasses UI glitches)
    first_automated_job = driver.find_element(By.XPATH, "//a[contains(text(), 'Software Engineer Automated')]")
    job_title_text = first_automated_job.text
    print(f"Opening details for: {job_title_text}")
    
    driver.execute_script("arguments[0].click();", first_automated_job)

    # 5. SMART WAIT: Wait strictly for the BUTTON itself to be clickable
    print("Waiting for the Delete button to render...")
    
    # Notice the change to //button and contains(., ...) to handle nested text
    delete_button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Delete vacancy')]")))
    
    time.sleep(1) # Brief pause to ensure background scripts are loaded

    # 6. Scroll down to make sure the button is visible on the screen
    driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", delete_button)
    time.sleep(2) # Wait for the smooth scrolling to finish

    # Perform a standard Selenium click (simulates a real human mouse click)
    delete_button.click()

    

    # Handle the native browser alert popup
    print("Accepting the confirmation popup...")
    alert = wait.until(EC.alert_is_present())
    alert.accept()  # This clicks "OK" on the native browser popup

    # 7. SMART WAIT: Wait for the system to delete and redirect back to the main vacancies dashboard
    # 7. SMART WAIT: Wait for the system to delete and redirect back to the main vacancies dashboard
    print(f"Deleting... waiting for database confirmation.")
    wait.until(EC.url_to_be("https://hiretrack1-xi.vercel.app/vacancies"))
    time.sleep(2) # Allow table to re-render

    # 8. Verify the deletion
    if job_title_text not in driver.page_source:
        print(f"✅ Test Passed: Job '{job_title_text}' was deleted successfully.")
    else:
        print(f"❌ Test Failed: '{job_title_text}' is still visible on the dashboard.")

except Exception as e:
    # If the script fails, it will print the EXACT error here instead of just crashing
    print(f"❌ TEST CRASHED: An error occurred during the test:")
    print(e)

finally:
    # 9. Close browser
    driver.quit()