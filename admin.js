document.addEventListener("DOMContentLoaded", function () {
    const backendURL = "/api"; // Adjust this as needed

    // Fetch and display buildings
    async function loadBuildings() {
        const response = await fetch(`${backendURL}/buildings`);
        const buildings = await response.json();
        const tableBody = document.querySelector("#buildings-table tbody");
        tableBody.innerHTML = "";
        
        buildings.forEach((building) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${building.building_id}</td>
                <td>${building.name}</td>
                <td>${building.address}</td>
                <td>${building.town}</td>
                <td>${building.latitude}</td>
                <td>${building.longitude}</td>
                <td>${building.management_company || "N/A"}</td>
                <td><button onclick="deleteBuilding(${building.building_id})">Delete</button></td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Fetch and display controllers
    async function loadControllers() {
        const response = await fetch(`${backendURL}/controllers`);
        const controllers = await response.json();
        const tableBody = document.querySelector("#controllers-table tbody");
        tableBody.innerHTML = "";
        
        controllers.forEach((controller) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${controller.controller_id}</td>
                <td>${controller.serial_number}</td>
                <td>${controller.vendor || "N/A"}</td>
                <td>${controller.model || "N/A"}</td>
                <td>${controller.building_id}</td>
                <td>${controller.status}</td>
                <td><button onclick="deleteController(${controller.controller_id})">Delete</button></td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Function to send POST requests
    async function postData(url, data) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error("Failed to submit data");
            }

            alert("Success");
            loadBuildings();
            loadControllers();
        } catch (err) {
            console.error("Error:", err);
            alert("Error submitting data");
        }
    }

    // Handle Building Form Submission
    document.getElementById("add-building-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const buildingData = {
            name: document.getElementById("building-name").value,
            address: document.getElementById("building-address").value,
            town: document.getElementById("building-town").value,
            latitude: parseFloat(document.getElementById("building-latitude").value),
            longitude: parseFloat(document.getElementById("building-longitude").value),
            management_company: document.getElementById("building-management").value
        };
        postData(`${backendURL}/buildings`, buildingData);
    });

    // Handle Controller Form Submission
    document.getElementById("add-controller-form").addEventListener("submit", function (event) {
        event.preventDefault();
        const controllerData = {
            serial_number: document.getElementById("controller-serial").value,
            vendor: document.getElementById("controller-vendor").value,
            model: document.getElementById("controller-model").value,
            building_id: parseInt(document.getElementById("controller-building-id").value),
            status: document.getElementById("controller-status").value
        };
        postData(`${backendURL}/controllers`, controllerData);
    });

    // Delete Building
//    async function deleteBuilding(id) {
//        if (confirm("Are you sure you want to delete this building?")) {
//            await fetch(`${backendURL}/buildings/${id}`, { method: "DELETE" });
//            loadBuildings();
//        }
//    }
    async function deleteBuilding(buildingId) {
        if (!confirm("Are you sure you want to delete this building?")) return;
    
        try {
            const response = await fetch(`/api/buildings/${buildingId}`, { method: "DELETE" });
            if (response.ok) {
                alert("Building deleted successfully.");
                location.reload(); // Refresh page after deletion
            } else {
                alert("Error deleting building.");
            }
        } catch (error) {
            console.error("Error deleting building:", error);
            alert("Failed to connect to the server.");
        }
    }

    // Delete Controller
    async function deleteController(id) {
        if (confirm("Are you sure you want to delete this controller?")) {
            await fetch(`${backendURL}/controllers/${id}`, { method: "DELETE" });
            loadControllers();
        }
    }

    // Load data initially
    loadBuildings();
    loadControllers();
});
