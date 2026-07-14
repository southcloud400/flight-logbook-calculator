
const imageInput =
    document.getElementById("image-input");

const imagePreview =
    document.getElementById("image-preview");

const selectedFileName =
    document.getElementById("selected-file-name");

const readButton =
    document.getElementById("read-button");

const resultMessage =
    document.getElementById("result-message");

const flightTimeTableBody =
    document.getElementById(
        "flight-time-table-body"
    );

const flightTimeTotalValue =
    document.getElementById(
        "flight-time-total-value"
    );

const WORKER_URL =
    "https://flight-logbook-worker.just-966.workers.dev";

let selectedImageFile = null;
let flightTimeRows = [];


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

        displayFlightTimes(
            result.data.rows
        );

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

function displayFlightTimes(rows) {

    flightTimeTableBody.innerHTML = "";
    flightTimeTotalValue.textContent = "0:00";

    if (
        !Array.isArray(rows) ||
        rows.length === 0
    ) {
        flightTimeRows = [];

        resultMessage.textContent =
            "Flight Timeは検出されませんでした。";

        return;
    }

    flightTimeRows =
        rows.map((rowData) => ({
            ...rowData
        }));

    resultMessage.textContent = "";

    let totalMinutes = 0;

    flightTimeRows.forEach((rowData) => {

        const tableRow =
            document.createElement("tr");

        const rowNumberCell =
            document.createElement("td");

        const flightTimeCell =
            document.createElement("td");

        const pusCell =
            document.createElement("td");

        const flightTimeInput =
            document.createElement("input");

        const pusInput =
            document.createElement("input");

        rowNumberCell.textContent =
            rowData.row;

        flightTimeInput.type = "text";

        flightTimeInput.value =
            rowData.flightTime;

        flightTimeInput.className =
            "flight-time-input";

        flightTimeInput.dataset.row =
            rowData.row;

        flightTimeInput.addEventListener(
            "input",
            () => {

                rowData.flightTime =
                    flightTimeInput.value;

                updateFlightTimeTotal();
            }
        );

        flightTimeInput.addEventListener(
            "blur",
            () => {

                const formattedValue =
                    normalizeFlightTimeInput(
                        flightTimeInput.value
                    );

                flightTimeInput.value =
                    formattedValue;

                rowData.flightTime =
                    formattedValue;

                updateFlightTimeTotal();
            }
        );

        flightTimeInput.addEventListener(
            "keydown",
            (event) => {

                if (event.key !== "Enter") {
                    return;
                }

                event.preventDefault();

                moveToNextTimeInput(
                    flightTimeInput
                );
            }
        );

        pusInput.type = "text";

        pusInput.value =
            rowData.pus;

        pusInput.className =
            "flight-time-input";

        pusInput.dataset.row =
            rowData.row;

        pusInput.addEventListener(
            "input",
            () => {

                rowData.pus =
                    pusInput.value;
            }
        );

        pusInput.addEventListener(
            "blur",
            () => {

                const formattedValue =
                    normalizeFlightTimeInput(
                        pusInput.value
                    );

                pusInput.value =
                    formattedValue;

                rowData.pus =
                    formattedValue;
            }
        );

        pusInput.addEventListener(
            "keydown",
            (event) => {

                if (event.key !== "Enter") {
                    return;
                }

                event.preventDefault();

                moveToNextTimeInput(
                    pusInput
                );
            }
        );
                
        flightTimeCell.appendChild(
            flightTimeInput
        );

        pusCell.appendChild(
            pusInput
        );

        tableRow.appendChild(
            rowNumberCell
        );

        tableRow.appendChild(
            flightTimeCell
        );

        tableRow.appendChild(
            pusCell
        );

        flightTimeTableBody.appendChild(
            tableRow
        );

        totalMinutes +=
            flightTimeToMinutes(
                rowData.flightTime
            );
    });

    updateFlightTimeTotal();
}

function normalizeFlightTimeInput(value) {

    const digits =
        value.replace(/\D/g, "");

    if (digits.length === 0) {
        return "";
    }

    if (digits.length === 1) {
        return `0:0${digits}`;
    }

    if (digits.length === 2) {
        return `0:${digits}`;
    }

    const hours =
        digits.slice(0, -2);

    const minutes =
        digits.slice(-2);

    return `${Number(hours)}:${minutes}`;
}

function moveToNextTimeInput(currentInput) {

    const currentCell =
        currentInput.closest("td");

    const currentRow =
        currentCell.parentElement;

    const columnIndex =
        currentCell.cellIndex;

    const nextRow =
        currentRow.nextElementSibling;

    if (!nextRow) {
        return;
    }

    const nextInput =
        nextRow.cells[columnIndex]
            ?.querySelector("input");

    if (!nextInput) {
        return;
    }

    nextInput.focus();
    nextInput.select();
}

function flightTimeToMinutes(flightTime) {

    const parts =
        flightTime.split(":");

    if (parts.length !== 2) {
        return 0;
    }

    const hours =
        Number(parts[0]);

    const minutes =
        Number(parts[1]);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        minutes < 0 ||
        minutes >= 60
    ) {
        return 0;
    }

    return hours * 60 + minutes;
}

function updateFlightTimeTotal() {

    let totalMinutes = 0;

    flightTimeRows.forEach((rowData) => {

        totalMinutes +=
            flightTimeToMinutes(
                rowData.flightTime
            );
    });

    flightTimeTotalValue.textContent =
        minutesToFlightTime(totalMinutes);
}


function minutesToFlightTime(totalMinutes) {

    const hours =
        Math.floor(totalMinutes / 60);

    const minutes =
        totalMinutes % 60;

    return (
        hours +
        ":" +
        String(minutes).padStart(2, "0")
    );
}