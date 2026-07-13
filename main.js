
const imageInput =
    document.getElementById("image-input");

const imagePreview =
    document.getElementById("image-preview");

const selectedFileName =
    document.getElementById("selected-file-name");

const readButton =
    document.getElementById("read-button");

const WORKER_URL =
    "https://flight-logbook-worker.just-966.workers.dev";

let selectedImageFile = null;


imageInput.addEventListener("change", () => {

    selectedImageFile =
        imageInput.files[0];

    if (!selectedImageFile) {
        return;
    }

    selectedFileName.textContent =
        selectedImageFile.name;

    const imageUrl =
        URL.createObjectURL(selectedImageFile);

    imagePreview.src =
        imageUrl;
});


readButton.addEventListener("click", async () => {

    if (!selectedImageFile) {
        alert("先にログブック画像を選択してください。");
        return;
    }

    readButton.disabled = true;
    readButton.textContent = "Reading...";

    try {
        const imageData =
            await fileToDataUrl(selectedImageFile);

        const response =
            await fetch(WORKER_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    image: imageData
                })
            });

        const result =
            await response.json();

        console.log(
            "Worker response:",
            result
        );

        if (!response.ok) {
            throw new Error(
                result.error ||
                "読み取りに失敗しました。"
            );
        }

    } catch (error) {
        console.error(
            "Flight Time reading error:",
            error
        );

        alert(error.message);

    } finally {
        readButton.disabled = false;
        readButton.textContent =
            "Read Flight Time";
    }
});


function fileToDataUrl(file) {

    return new Promise((resolve, reject) => {

        const reader =
            new FileReader();

        reader.onload = () => {
            resolve(reader.result);
        };

        reader.onerror = () => {
            reject(
                new Error(
                    "画像の読み込みに失敗しました。"
                )
            );
        };

        reader.readAsDataURL(file);
    });
}